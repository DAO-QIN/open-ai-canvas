package app

import (
	"encoding/json"
	"yingce/backend/internal/model"
)

// prepareTaskAdmission reuses the normal validation, routing and quote path
// without enqueueing or reserving credits. The owning domain supplies its
// authorization checks and atomically calls createTaskWithStorageQuotaRepository.
// Canvas proposal scope remains in prepareCreationTask.
func (s *Service) prepareTaskAdmission(userID string, req CreateTaskRequest) (*model.Task, *model.BillingOrder, string, error) {
	prepared := &creationTaskPreparation{}
	req.creationPrepare = prepared
	task, err := s.CreateTask(userID, req)
	if err != nil {
		return nil, nil, "", err
	}
	var input map[string]any
	if err = json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return nil, nil, "", err
	}
	config, _ := input["config"].(map[string]any)
	signature, err := s.repo.CreationPriceSignature(task, stringValue(config["channelId"]), stringValue(config["model"]))
	return task, prepared.Order, signature, err
}
