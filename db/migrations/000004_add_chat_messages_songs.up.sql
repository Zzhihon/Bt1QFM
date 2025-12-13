-- 添加 songs 字段到 chat_messages 表，用于存储聊天中的歌曲卡片数据
ALTER TABLE chat_messages ADD COLUMN songs JSON DEFAULT NULL COMMENT '关联的歌曲卡片(JSON格式)';
