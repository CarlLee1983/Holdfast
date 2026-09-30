-- 本機開發用 seed：2 個資源、數個從「明天」起算的時段（時間為 UTC epoch 毫秒）。
-- 可重複執行：先清空再寫入。
DELETE FROM slots;
DELETE FROM resources;

INSERT INTO resources (id, name, hold_ttl_seconds, seats_per_hold, cancellation_cutoff_seconds, description) VALUES
  (1, '大廳用餐', 600, 4, 7200, '面向開放廚房的長桌與雙人座'),
  (2, '包廂', 600, 10, 86400, '獨立空間，適合 6–10 位');

-- 台北 = UTC+8：+11 小時 = 台北 19:00、+13 小時 = 21:00、+3 小時 = 11:00
INSERT INTO slots (resource_id, starts_at, ends_at, capacity) VALUES
  (1, unixepoch('now', 'start of day', '+1 day', '+3 hours') * 1000, unixepoch('now', 'start of day', '+1 day', '+5 hours') * 1000, 20),
  (1, unixepoch('now', 'start of day', '+1 day', '+11 hours') * 1000, unixepoch('now', 'start of day', '+1 day', '+13 hours') * 1000, 20),
  (1, unixepoch('now', 'start of day', '+2 day', '+11 hours') * 1000, unixepoch('now', 'start of day', '+2 day', '+13 hours') * 1000, 16),
  (2, unixepoch('now', 'start of day', '+1 day', '+11 hours') * 1000, unixepoch('now', 'start of day', '+1 day', '+14 hours') * 1000, 10),
  (2, unixepoch('now', 'start of day', '+2 day', '+2 hours') * 1000, unixepoch('now', 'start of day', '+2 day', '+5 hours') * 1000, 10);
