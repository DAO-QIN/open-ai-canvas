package repository

import (
	"errors"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func receivedSignal(ch <-chan struct{}) bool {
	select {
	case <-ch:
		return true
	case <-time.After(50 * time.Millisecond):
		return false
	}
}

func TestChangeSignalsCoalesceAndUnsubscribe(t *testing.T) {
	signals := NewChangeSignals()
	first, stopFirst := signals.Subscribe("k")
	second, stopSecond := signals.Subscribe("k")
	other, stopOther := signals.Subscribe("other")
	defer stopOther()

	// 连续多次变化只留一次唤醒，发送方不会因为没人读而阻塞。
	signals.Notify("k")
	signals.Notify("k")
	if !receivedSignal(first) || !receivedSignal(second) {
		t.Fatal("subscribers of the changed key were not woken")
	}
	if receivedSignal(first) {
		t.Fatal("repeated notifications were not coalesced")
	}
	if receivedSignal(other) {
		t.Fatal("a different key was woken")
	}

	stopFirst()
	stopFirst()
	signals.Notify("k")
	if receivedSignal(first) {
		t.Fatal("unsubscribed channel still received a signal")
	}
	if !receivedSignal(second) {
		t.Fatal("remaining subscriber missed the signal")
	}
	stopSecond()
	if len(signals.subs) != 1 {
		t.Fatalf("empty subscription sets were not removed: %d keys left", len(signals.subs))
	}
}

func TestChangeSignalsNilIsSafe(t *testing.T) {
	var signals *ChangeSignals
	ch, stop := signals.Subscribe("k")
	signals.Notify("k")
	stop()
	if receivedSignal(ch) {
		t.Fatal("nil signals must never wake a subscriber")
	}
	repo := &Repository{}
	repo.signalChanged(taskSignalKey("task"))
}

func TestTransactionDefersSignalsUntilCommit(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newRepositoryID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	repo := New(db).WithChangeSignals(NewChangeSignals())
	changed, stop := repo.SubscribeTask("task-1")
	defer stop()

	err = repo.Transaction(func(tx *Repository) error {
		tx.signalChanged(taskSignalKey("task-1"))
		if receivedSignal(changed) {
			t.Fatal("signal was sent before the transaction committed")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !receivedSignal(changed) {
		t.Fatal("signal was not sent after commit")
	}

	rollback := errors.New("rollback")
	err = repo.Transaction(func(tx *Repository) error {
		tx.signalChanged(taskSignalKey("task-1"))
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("unexpected transaction error: %v", err)
	}
	if receivedSignal(changed) {
		t.Fatal("a rolled back transaction must not wake waiters")
	}

	// 嵌套事务只在最外层提交后发出。
	err = repo.Transaction(func(outer *Repository) error {
		if err := outer.Transaction(func(inner *Repository) error {
			inner.signalChanged(taskSignalKey("task-1"))
			return nil
		}); err != nil {
			return err
		}
		if receivedSignal(changed) {
			t.Fatal("inner commit woke waiters before the outer transaction committed")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !receivedSignal(changed) {
		t.Fatal("signal was lost across nested transactions")
	}
}

func TestRepositoryWritesWakeSubscribers(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newRepositoryID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}, &model.CloudAgentExecution{}, &model.CloudAgentEventRecord{}, &model.CloudAgentMessageRecord{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db).WithChangeSignals(NewChangeSignals())
	if !repo.ChangeSignalsEnabled() || New(db).ChangeSignalsEnabled() {
		t.Fatal("ChangeSignalsEnabled does not reflect the configured notifier")
	}

	leaseExpiresAt := time.Now().Add(time.Minute)
	for _, task := range []model.Task{
		{ID: "terminal", UserID: "user", Status: model.TaskStatusRunning, LeaseOwner: "owner", LeaseExpiresAt: &leaseExpiresAt},
		{ID: "cancelled", UserID: "user", Status: model.TaskStatusQueued},
	} {
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	terminal, stopTerminal := repo.SubscribeTask("terminal")
	defer stopTerminal()
	if ok, err := repo.UpdateTaskTerminalState("terminal", "owner", model.TaskStatusRunning, model.TaskStatusSucceeded, "完成", "", time.Now()); err != nil || !ok {
		t.Fatalf("terminal update failed: %v %v", ok, err)
	}
	if !receivedSignal(terminal) {
		t.Fatal("task terminal state did not wake its waiter")
	}
	// 条件更新没有命中时不发信号，等待方不会被无意义地唤醒。
	if ok, _ := repo.UpdateTaskTerminalState("terminal", "owner", model.TaskStatusRunning, model.TaskStatusFailed, "失败", "", time.Now()); ok || receivedSignal(terminal) {
		t.Fatal("a no-op terminal update still woke the waiter")
	}
	cancelled, stopCancelled := repo.SubscribeTask("cancelled")
	defer stopCancelled()
	if ok, err := repo.CancelTaskIfStatus("user", "cancelled", model.TaskStatusQueued, time.Now()); err != nil || !ok {
		t.Fatalf("cancel failed: %v %v", ok, err)
	}
	if !receivedSignal(cancelled) {
		t.Fatal("task cancellation did not wake its waiter")
	}

	if err := db.Create(&model.CloudAgentExecution{ID: "run", UserID: "user", Status: "running", Revision: 1, StateJSON: `{}`}).Error; err != nil {
		t.Fatal(err)
	}
	run, stopRun := repo.SubscribeCloudAgentRun("run")
	defer stopRun()
	if err := repo.MutateCloudAgent("user", "run", 1, func(*model.CloudAgentExecution, *Repository) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if !receivedSignal(run) {
		t.Fatal("a committed run mutation did not wake the event stream")
	}
	if err := repo.MutateCloudAgent("user", "run", 1, func(*model.CloudAgentExecution, *Repository) error { return nil }); !errors.Is(err, ErrCreationConflict) {
		t.Fatalf("stale revision should conflict, got %v", err)
	}
	if receivedSignal(run) {
		t.Fatal("a conflicting mutation woke the event stream")
	}
	if err := repo.MarkCloudAgentCancelled("user", "run", 2); err != nil {
		t.Fatal(err)
	}
	if !receivedSignal(run) {
		t.Fatal("run cancellation did not wake the event stream")
	}
}
