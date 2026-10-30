CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(24) NOT NULL UNIQUE,
  display_name VARCHAR(60) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  bio VARCHAR(240) NOT NULL DEFAULT '',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (username ~ '^[a-zA-Z0-9_]{3,24}$')
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, followed_id),
  CHECK (follower_id <> followed_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body VARCHAR(2000) NOT NULL DEFAULT '',
  media_url TEXT,
  media_type VARCHAR(10) CHECK (media_type IN ('image','video')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (length(body) > 0 OR media_url IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS post_likes (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body VARCHAR(1000) NOT NULL CHECK (length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id BIGSERIAL PRIMARY KEY,
  sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body VARCHAR(4000) NOT NULL CHECK (length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS posts_user_id_idx ON posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS comments_post_id_idx ON comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS messages_pair_idx ON direct_messages(sender_id, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS follows_followed_idx ON follows(followed_id);

CREATE TABLE IF NOT EXISTS groups (id BIGSERIAL PRIMARY KEY, name VARCHAR(80) NOT NULL, slug VARCHAR(100) NOT NULL UNIQUE, description VARCHAR(500) NOT NULL DEFAULT '', created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS group_members (group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role VARCHAR(12) NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')), joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(group_id,user_id));
CREATE TABLE IF NOT EXISTS stories (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, media_url TEXT, media_type VARCHAR(10) CHECK(media_type IN ('image','video')), body VARCHAR(280) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '24 hours', CHECK(length(body)>0 OR media_url IS NOT NULL));
CREATE TABLE IF NOT EXISTS notifications (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL, kind VARCHAR(24) NOT NULL CHECK(kind IN ('follow','like','comment','message','group')), entity_id BIGINT, body VARCHAR(240) NOT NULL, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members(user_id);
CREATE INDEX IF NOT EXISTS stories_expiry_idx ON stories(expires_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id,created_at DESC);
