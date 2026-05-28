-- Lược đồ cơ sở dữ liệu D1 Database quản lý License cho Flowkit
DROP TABLE IF EXISTS licenses;

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,               -- UUID định danh
  license_key TEXT UNIQUE NOT NULL,  -- Định dạng: FK-XXXX-XXXX-XXXX-XXXX
  machine_id TEXT,                   -- Mã băm SHA-256 duy nhất của thiết bị kích hoạt (NULL nếu chưa dùng)
  status TEXT DEFAULT 'INACTIVE',    -- INACTIVE, ACTIVE, EXPIRED
  duration_type TEXT NOT NULL,       -- TRIAL (3 ngày), 1_MONTH, 6_MONTHS, 1_YEAR
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  activated_at DATETIME,
  expires_at DATETIME
);

-- Index tối ưu hóa tìm kiếm License Key
CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);
