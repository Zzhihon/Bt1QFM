-- 添加 source 字段到 tracks 表
-- source: 'library' = 直接上传到library, 'album' = 通过album上传
ALTER TABLE tracks ADD COLUMN source VARCHAR(20) DEFAULT 'library' AFTER state;
