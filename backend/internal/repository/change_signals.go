package repository

import "sync"

// ChangeSignals 在 Agent 运行或任务提交变化后，唤醒同一进程里的等待方（运行 SSE、等任务结束的工具）。
// 它只表示"该重新读了"：读到的内容仍以数据库为准；多实例部署或通知丢失时，由等待方的兜底轮询追上。
type ChangeSignals struct {
	mu   sync.Mutex
	subs map[string]map[chan struct{}]struct{}
}

func NewChangeSignals() *ChangeSignals {
	return &ChangeSignals{subs: make(map[string]map[chan struct{}]struct{})}
}

// Subscribe 返回容量为 1 的通道：连续多次变化合并成一次唤醒，发送方永不阻塞。
// 调用方必须在读库之前订阅，并在结束时调用返回的取消函数。
func (s *ChangeSignals) Subscribe(key string) (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	if s == nil {
		return ch, func() {}
	}
	s.mu.Lock()
	set := s.subs[key]
	if set == nil {
		set = make(map[chan struct{}]struct{})
		s.subs[key] = set
	}
	set[ch] = struct{}{}
	s.mu.Unlock()
	var once sync.Once
	return ch, func() {
		once.Do(func() {
			s.mu.Lock()
			defer s.mu.Unlock()
			if set := s.subs[key]; set != nil {
				delete(set, ch)
				if len(set) == 0 {
					delete(s.subs, key)
				}
			}
		})
	}
}

func (s *ChangeSignals) Notify(key string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.subs[key] {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func cloudAgentRunSignalKey(id string) string { return "cloud-agent-run:" + id }

func taskSignalKey(id string) string { return "task:" + id }

// ChangeSignalsEnabled 让等待方决定兜底轮询间隔：没有接通知时保持原来的高频轮询。
func (r *Repository) ChangeSignalsEnabled() bool { return r.changeSignals != nil }

// WithChangeSignals 让仓储在运行修订号和任务终态提交后发出唤醒。
func (r *Repository) WithChangeSignals(signals *ChangeSignals) *Repository {
	copy := *r
	copy.changeSignals = signals
	return &copy
}

// SubscribeCloudAgentRun 在该运行的修订号提交变化后收到唤醒。
func (r *Repository) SubscribeCloudAgentRun(id string) (<-chan struct{}, func()) {
	return r.changeSignals.Subscribe(cloudAgentRunSignalKey(id))
}

// SubscribeTask 在该任务进入终态（成功、失败、取消）后收到唤醒。
func (r *Repository) SubscribeTask(id string) (<-chan struct{}, func()) {
	return r.changeSignals.Subscribe(taskSignalKey(id))
}

// signalChanged 在事务内只记下来，等最外层提交成功后再发，避免等待方读到未提交的旧值。
func (r *Repository) signalChanged(key string) {
	if r.changeSignals == nil {
		return
	}
	if r.pendingSignals != nil {
		r.pendingSignals[key] = struct{}{}
		return
	}
	r.changeSignals.Notify(key)
}
