-- 修改 netease_song 表的 file_path 字段长度
ALTER TABLE netease_song MODIFY COLUMN file_path VARCHAR(1000); 