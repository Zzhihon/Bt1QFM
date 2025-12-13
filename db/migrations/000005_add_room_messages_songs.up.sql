-- 添加 songs 字段到 room_messages 表，用于存储聊天室中的歌曲卡片数据
ALTER TABLE room_messages ADD COLUMN songs JSON DEFAULT NULL COMMENT '关联的歌曲卡片(JSON格式)';
