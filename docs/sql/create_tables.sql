
-- 처방 메시지 영구 저장
CREATE TABLE IF NOT EXISTS growth_messages (
  id TEXT PRIMARY KEY,
  student_code TEXT NOT NULL,
  student_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  admin_edited BOOLEAN DEFAULT false,
  type TEXT DEFAULT 'prescription',
  report_month TEXT DEFAULT ''
);
ALTER TABLE growth_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all growth_messages"
ON growth_messages FOR ALL TO anon
USING (true) WITH CHECK (true);

-- WW/CLINIC 주문 영구 저장
CREATE TABLE IF NOT EXISTS ww_orders (
  order_id TEXT PRIMARY KEY,
  order_type TEXT NOT NULL,
  student_code TEXT NOT NULL,
  student_name TEXT NOT NULL,
  school TEXT DEFAULT '',
  grade TEXT DEFAULT '',
  exam_date TEXT DEFAULT '',
  exam_range TEXT DEFAULT '',
  weak_points JSONB DEFAULT '[]',
  target_score INTEGER DEFAULT 0,
  current_score INTEGER DEFAULT 0,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  memo TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  order_category TEXT DEFAULT 'ww'  -- 'ww' | 'clinic'
);
ALTER TABLE ww_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all ww_orders"
ON ww_orders FOR ALL TO anon
USING (true) WITH CHECK (true);
