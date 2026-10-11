package ecommerce

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"strings"
	"unicode"
	"yingce/backend/internal/model"
)

type ExportSlot struct {
	SlotID  string `json:"slotId"`
	Kind    string `json:"kind"`
	Index   int    `json:"index"`
	Version int    `json:"version,omitempty"`
	File    string `json:"file,omitempty"`
	Status  string `json:"status"`
	Missing bool   `json:"missing"`
}
type ExportManifest struct {
	ProductID     string       `json:"productId"`
	Name          string       `json:"name"`
	RunID         string       `json:"runId,omitempty"`
	RunNumber     int          `json:"runNumber,omitempty"`
	Titles        []string     `json:"titles"`
	TitlesMissing bool         `json:"titlesMissing"`
	Slots         []ExportSlot `json:"slots"`
	Partial       bool         `json:"partial"`
}

func safeName(value string) string {
	runes := []rune{}
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' {
			runes = append(runes, r)
		} else {
			runes = append(runes, '_')
		}
		if len(runes) >= 60 {
			break
		}
	}
	if len(runes) == 0 {
		return "product"
	}
	return string(runes)
}
func imageExtension(mime string) string {
	switch strings.ToLower(mime) {
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/avif":
		return ".avif"
	case "image/gif":
		return ".gif"
	default:
		return ".png"
	}
}
func (s *Service) Export(ctx context.Context, userID string, productIDs []string, w io.Writer) error {
	return s.export(ctx, userID, productIDs, nil, w)
}
func (s *Service) ExportRun(ctx context.Context, userID, productID, runID string, w io.Writer) error {
	return s.export(ctx, userID, []string{productID}, map[string]string{productID: runID}, w)
}
func (s *Service) export(ctx context.Context, userID string, productIDs []string, runs map[string]string, w io.Writer) error {
	if len(productIDs) < 1 || len(productIDs) > 100 {
		return invalid("请选择 1 到 100 个商品")
	}
	views := []*ProductView{}
	seen := map[string]bool{}
	// Validate the entire selection before opening any output or resource.
	for _, id := range productIDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		view, e := s.Product(userID, id)
		if e != nil {
			return e
		}
		if runID := runs[id]; runID != "" {
			run, e := s.Run(userID, id, runID)
			if e != nil {
				return e
			}
			view.Run = run
		}
		views = append(views, view)
	}
	archive := zip.NewWriter(w)
	totalBytes := int64(0)
	for index, view := range views {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		folder := fmt.Sprintf("%03d-%s-%s/", index+1, safeName(view.Name), view.ID[:8])
		manifest := ExportManifest{ProductID: view.ID, Name: view.Name, Titles: []string{}, Slots: []ExportSlot{}, TitlesMissing: true, Partial: true}
		if run := view.Run; run != nil {
			manifest.RunID = run.ID
			manifest.RunNumber = run.Number
			manifest.Titles = run.Titles
			manifest.TitlesMissing = len(run.Titles) == 0
			manifest.Partial = manifest.TitlesMissing
			for _, slot := range run.Slots {
				entry := ExportSlot{SlotID: slot.ID, Kind: slot.Kind, Index: slot.Index, Status: slot.Status, Missing: true}
				var selected *model.EcommerceImageVersion
				for i := range slot.Versions {
					if slot.Versions[i].ID == slot.SelectedVersionID {
						selected = &slot.Versions[i]
						break
					}
				}
				if selected != nil {
					resource, reader, e := s.host.OpenResource(userID, selected.ResourceID)
					if e != nil {
						return e
					}
					if resource.Size > 256<<20 || totalBytes+resource.Size > 256<<20 {
						_ = reader.Close()
						return invalid("打包内容超过 256MB，请减少选中商品")
					}
					entry.File = fmt.Sprintf("%s/%02d-v%d%s", slot.Kind, slot.Index, selected.Number, imageExtension(resource.MimeType))
					entry.Version = selected.Number
					entry.Missing = false
					file, e := archive.Create(folder + entry.File)
					if e != nil {
						_ = reader.Close()
						return e
					}
					n, e := io.Copy(file, io.LimitReader(reader, (256<<20)-totalBytes+1))
					_ = reader.Close()
					if e != nil {
						return e
					}
					totalBytes += n
					if totalBytes > 256<<20 {
						return invalid("打包内容超过 256MB，请减少选中商品")
					}
				} else {
					manifest.Partial = true
				}
				manifest.Slots = append(manifest.Slots, entry)
			}
		}
		file, e := archive.Create(folder + "manifest.json")
		if e != nil {
			return e
		}
		if _, e = io.WriteString(file, encode(manifest)); e != nil {
			return e
		}
		titles, e := archive.Create(folder + "titles.txt")
		if e != nil {
			return e
		}
		if _, e = io.WriteString(titles, strings.Join(manifest.Titles, "\n")); e != nil {
			return e
		}
	}
	return archive.Close()
}
