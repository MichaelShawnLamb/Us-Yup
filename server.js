import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import pg from "pg";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === "production";
const jwtSecret = process.env.JWT_SECRET;
if (!process.env.DATABASE_URL || !jwtSecret || jwtSecret.length < 32) {
  console.error("Missing DATABASE_URL or JWT_SECRET (must be at least 32 characters). Copy .env.example to .env.");
  process.exit(1);
}
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: true } : undefined });
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const maxBytes = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 30)) * 1024 * 1024;
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomBytes(8).toString("hex")}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime))$/i.test(file.mimetype);
    cb(allowed ? null : new Error("Only JPG, PNG, GIF, WEBP, MP4, WEBM, or MOV files are allowed."), allowed);
  }
});
app.use("/uploads", express.static(uploadDir, { dotfiles: "deny", index: false, maxAge: isProd ? "1d" : 0 }));
app.use(express.static(path.join(__dirname, "public")));

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const publicUser = row => ({
  id: row.id, username: row.username, displayName: row.display_name,
  bio: row.bio || "", avatarUrl: row.avatar_url || null, createdAt: row.created_at
});
function makeToken(user) {
  return jwt.sign({ sub: String(user.id), username: user.username }, jwtSecret, { expiresIn: "7d", issuer: "circle", audience: "circle-web" });
}
function setAuthCookie(res, token) {
  res.cookie("circle_session", token, { httpOnly: true, secure: isProd, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000, path: "/" });
}
function clearAuthCookie(res) {
  res.clearCookie("circle_session", { httpOnly: true, secure: isProd, sameSite: "lax", path: "/" });
}
const auth = asyncRoute(async (req, res, next) => {
  const token = req.cookies.circle_session;
  if (!token) return res.status(401).json({ error: "Please sign in to continue." });
  try {
    const payload = jwt.verify(token, jwtSecret, { issuer: "circle", audience: "circle-web" });
    const result = await pool.query("SELECT id, username, display_name, email, bio, avatar_url, created_at FROM users WHERE id=$1", [payload.sub]);
    if (!result.rowCount) { clearAuthCookie(res); return res.status(401).json({ error: "Session user no longer exists." }); }
    req.user = result.rows[0];
    next();
  } catch { clearAuthCookie(res); return res.status(401).json({ error: "Your session expired. Please sign in again." }); }
});
function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "Circle API" }));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const username = cleanText(req.body.username, 24).toLowerCase();
  const displayName = cleanText(req.body.displayName, 60);
  const email = cleanText(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: "Username must be 3–24 characters: letters, numbers, or underscores." });
  if (!displayName) return res.status(400).json({ error: "Please enter a display name." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 10 || password.length > 72) return res.status(400).json({ error: "Password must be 10–72 characters." });
  const hash = await bcrypt.hash(password, 12);
  try {
    const result = await pool.query("INSERT INTO users(username,display_name,email,password_hash) VALUES($1,$2,$3,$4) RETURNING id,username,display_name,email,bio,avatar_url,created_at", [username, displayName, email, hash]);
    const user = result.rows[0]; setAuthCookie(res, makeToken(user)); res.status(201).json({ user: publicUser(user) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "That username or email is already registered." });
    throw e;
  }
}));
app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const result = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
  if (!result.rowCount || !(await bcrypt.compare(password, result.rows[0].password_hash))) return res.status(401).json({ error: "Email or password is incorrect." });
  setAuthCookie(res, makeToken(result.rows[0])); res.json({ user: publicUser(result.rows[0]) });
}));
app.post("/api/auth/logout", (_req, res) => { clearAuthCookie(res); res.json({ ok: true }); });
app.get("/api/me", auth, (req, res) => res.json({ user: publicUser(req.user) }));
app.patch("/api/me", auth, asyncRoute(async (req, res) => {
  const displayName = cleanText(req.body.displayName, 60);
  const bio = cleanText(req.body.bio, 240);
  if (!displayName) return res.status(400).json({ error: "Display name cannot be empty." });
  const result = await pool.query("UPDATE users SET display_name=$1,bio=$2 WHERE id=$3 RETURNING id,username,display_name,email,bio,avatar_url,created_at", [displayName, bio, req.user.id]);
  res.json({ user: publicUser(result.rows[0]) });
}));

app.get("/api/users", auth, asyncRoute(async (req, res) => {
  const q = cleanText(req.query.q, 60);
  const result = await pool.query(
    `SELECT u.id,u.username,u.display_name,u.bio,u.avatar_url,u.created_at,
      EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$1 AND f.followed_id=u.id) AS is_following
     FROM users u WHERE u.id<>$1 AND ($2='' OR u.username ILIKE '%'||$2||'%' OR u.display_name ILIKE '%'||$2||'%')
     ORDER BY u.created_at DESC LIMIT 30`, [req.user.id, q]);
  res.json({ users: result.rows.map(r => ({ ...publicUser(r), isFollowing: r.is_following })) });
}));
app.get("/api/users/:id", auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT u.id,u.username,u.display_name,u.bio,u.avatar_url,u.created_at,
     (SELECT count(*) FROM follows WHERE followed_id=u.id) AS followers,
     (SELECT count(*) FROM follows WHERE follower_id=u.id) AS following,
     EXISTS(SELECT 1 FROM follows WHERE follower_id=$2 AND followed_id=u.id) AS is_following
     FROM users u WHERE u.id=$1`, [req.params.id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "User not found." });
  const r = result.rows[0]; res.json({ user: { ...publicUser(r), followers: Number(r.followers), following: Number(r.following), isFollowing: r.is_following } });
}));
app.post("/api/users/:id/follow", auth, asyncRoute(async (req, res) => {
  const target = String(req.params.id);
  if (target === String(req.user.id)) return res.status(400).json({ error: "You cannot follow yourself." });
  const exists = await pool.query("SELECT id FROM users WHERE id=$1", [target]);
  if (!exists.rowCount) return res.status(404).json({ error: "User not found." });
  const already = await pool.query("SELECT 1 FROM follows WHERE follower_id=$1 AND followed_id=$2", [req.user.id, target]);
  if (already.rowCount) await pool.query("DELETE FROM follows WHERE follower_id=$1 AND followed_id=$2", [req.user.id, target]);
  else { await pool.query("INSERT INTO follows(follower_id,followed_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [req.user.id, target]); await notifyUser(target,req.user.id,"follow",null,`${req.user.display_name} followed you.`); }
  res.json({ following: !already.rowCount });
}));

app.post("/api/uploads", auth, upload.single("media"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose an image or video first." });
  const isVideo = req.file.mimetype.startsWith("video/");
  res.status(201).json({ mediaUrl: `/uploads/${req.file.filename}`, mediaType: isVideo ? "video" : "image" });
});
app.post("/api/posts", auth, asyncRoute(async (req, res) => {
  const body = cleanText(req.body.body, 2000);
  const mediaUrl = cleanText(req.body.mediaUrl, 500);
  const mediaType = ["image", "video"].includes(req.body.mediaType) ? req.body.mediaType : null;
  if (!body && !mediaUrl) return res.status(400).json({ error: "Write something or attach media." });
  if (mediaUrl && !mediaUrl.startsWith("/uploads/")) return res.status(400).json({ error: "Invalid uploaded media path." });
  const result = await pool.query("INSERT INTO posts(user_id,body,media_url,media_type) VALUES($1,$2,$3,$4) RETURNING *", [req.user.id, body, mediaUrl || null, mediaUrl ? mediaType : null]);
  res.status(201).json({ post: { ...result.rows[0], id: String(result.rows[0].id), user: publicUser(req.user), likes: 0, likedByMe: false, comments: [] } });
}));
app.get("/api/posts", auth, asyncRoute(async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 30)));
  const result = await pool.query(
    `SELECT p.id,p.user_id,p.body,p.media_url,p.media_type,p.created_at,
      u.username,u.display_name,u.bio,u.avatar_url,u.created_at AS user_created_at,
      (SELECT count(*) FROM post_likes l WHERE l.post_id=p.id) AS likes,
      EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id=p.id AND l.user_id=$1) AS liked_by_me,
      (SELECT count(*) FROM comments c WHERE c.post_id=p.id) AS comment_count
     FROM posts p JOIN users u ON u.id=p.user_id
     ORDER BY p.created_at DESC LIMIT $2`, [req.user.id, limit]);
  res.json({ posts: result.rows.map(r => ({
    id: String(r.id), body: r.body, mediaUrl: r.media_url, mediaType: r.media_type, createdAt: r.created_at,
    user: { id: String(r.user_id), username: r.username, displayName: r.display_name, bio: r.bio, avatarUrl: r.avatar_url, createdAt: r.user_created_at },
    likes: Number(r.likes), likedByMe: r.liked_by_me, commentCount: Number(r.comment_count)
  })) });
}));
app.post("/api/posts/:id/like", auth, asyncRoute(async (req, res) => {
  const post = await pool.query("SELECT id FROM posts WHERE id=$1", [req.params.id]);
  if (!post.rowCount) return res.status(404).json({ error: "Post not found." });
  const existing = await pool.query("SELECT 1 FROM post_likes WHERE user_id=$1 AND post_id=$2", [req.user.id, req.params.id]);
  if (existing.rowCount) await pool.query("DELETE FROM post_likes WHERE user_id=$1 AND post_id=$2", [req.user.id, req.params.id]);
  else await pool.query("INSERT INTO post_likes(user_id,post_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [req.user.id, req.params.id]);
  const count = await pool.query("SELECT count(*) FROM post_likes WHERE post_id=$1", [req.params.id]);
  if (!existing.rowCount) { const owner=await pool.query("SELECT user_id FROM posts WHERE id=$1",[req.params.id]); if(owner.rowCount) await notifyUser(owner.rows[0].user_id,req.user.id,"like",req.params.id,`${req.user.display_name} liked your post.`); }
  res.json({ liked: !existing.rowCount, likes: Number(count.rows[0].count) });
}));
app.get("/api/posts/:id/comments", auth, asyncRoute(async (req, res) => {
  const result = await pool.query("SELECT c.id,c.body,c.created_at,u.id AS user_id,u.username,u.display_name,u.bio,u.avatar_url,u.created_at AS user_created_at FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=$1 ORDER BY c.created_at ASC LIMIT 100", [req.params.id]);
  res.json({ comments: result.rows.map(r => ({ id: String(r.id), body: r.body, createdAt: r.created_at, user: { id: String(r.user_id), username: r.username, displayName: r.display_name, bio: r.bio, avatarUrl: r.avatar_url, createdAt: r.user_created_at } })) });
}));
app.post("/api/posts/:id/comments", auth, asyncRoute(async (req, res) => {
  const body = cleanText(req.body.body, 1000);
  if (!body) return res.status(400).json({ error: "Comment cannot be empty." });
  const result = await pool.query("INSERT INTO comments(post_id,user_id,body) SELECT p.id,$2,$3 FROM posts p WHERE p.id=$1 RETURNING id,post_id,body,created_at", [req.params.id, req.user.id, body]);
  if (!result.rowCount) return res.status(404).json({ error: "Post not found." });
  const owner=await pool.query("SELECT user_id FROM posts WHERE id=$1",[req.params.id]); if(owner.rowCount) await notifyUser(owner.rows[0].user_id,req.user.id,"comment",req.params.id,`${req.user.display_name} commented on your post.`);
  res.status(201).json({ comment: { ...result.rows[0], id: String(result.rows[0].id), user: publicUser(req.user) } });
}));

app.get("/api/messages/:userId", auth, asyncRoute(async (req, res) => {
  const other = String(req.params.userId);
  if (other === String(req.user.id)) return res.status(400).json({ error: "Choose another user." });
  const exists = await pool.query("SELECT id FROM users WHERE id=$1", [other]);
  if (!exists.rowCount) return res.status(404).json({ error: "User not found." });
  const result = await pool.query(
    `SELECT m.id,m.sender_id,m.recipient_id,m.body,m.created_at,
      su.username AS sender_username,su.display_name AS sender_name,
      ru.username AS recipient_username,ru.display_name AS recipient_name
     FROM direct_messages m JOIN users su ON su.id=m.sender_id JOIN users ru ON ru.id=m.recipient_id
     WHERE (m.sender_id=$1 AND m.recipient_id=$2) OR (m.sender_id=$2 AND m.recipient_id=$1)
     ORDER BY m.created_at ASC LIMIT 200`, [req.user.id, other]);
  res.json({ messages: result.rows.map(r => ({ id: String(r.id), senderId: String(r.sender_id), recipientId: String(r.recipient_id), body: r.body, createdAt: r.created_at })) });
}));
app.post("/api/messages/:userId", auth, asyncRoute(async (req, res) => {
  const body = cleanText(req.body.body, 4000), other = String(req.params.userId);
  if (!body) return res.status(400).json({ error: "Message cannot be empty." });
  if (other === String(req.user.id)) return res.status(400).json({ error: "You cannot message yourself." });
  const result = await pool.query("INSERT INTO direct_messages(sender_id,recipient_id,body) SELECT $1,id,$3 FROM users WHERE id=$2 RETURNING id,sender_id,recipient_id,body,created_at", [req.user.id, other, body]);
  if (!result.rowCount) return res.status(404).json({ error: "User not found." });
  const r = result.rows[0]; await notifyUser(r.recipient_id,req.user.id,"message",r.id,`${req.user.display_name} sent you a message.`); res.status(201).json({ message: { id: String(r.id), senderId: String(r.sender_id), recipientId: String(r.recipient_id), body: r.body, createdAt: r.created_at } });
}));


async function notifyUser(userId, actorId, kind, entityId, body) {
 if (!userId || String(userId)===String(actorId)) return;
 await pool.query("INSERT INTO notifications(user_id,actor_id,kind,entity_id,body) VALUES($1,$2,$3,$4,$5)",[userId,actorId||null,kind,entityId||null,body]);
}
app.get("/api/notifications", auth, asyncRoute(async(req,res)=>{
 const r=await pool.query(`SELECT n.id,n.kind,n.entity_id,n.body,n.read_at,n.created_at,u.id AS actor_id,u.username AS actor_username,u.display_name AS actor_name FROM notifications n LEFT JOIN users u ON u.id=n.actor_id WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 50`,[req.user.id]);
 res.json({notifications:r.rows.map(n=>({id:String(n.id),kind:n.kind,entityId:n.entity_id?String(n.entity_id):null,body:n.body,readAt:n.read_at,createdAt:n.created_at,actor:n.actor_id?{id:String(n.actor_id),username:n.actor_username,displayName:n.actor_name}:null}))});
}));
app.post("/api/notifications/read", auth, asyncRoute(async(req,res)=>{await pool.query("UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND read_at IS NULL",[req.user.id]);res.json({ok:true});}));
app.get("/api/groups", auth, asyncRoute(async(req,res)=>{
 const r=await pool.query(`SELECT g.id,g.name,g.slug,g.description,g.created_at,u.username AS creator_username,u.display_name AS creator_name,(SELECT count(*) FROM group_members gm WHERE gm.group_id=g.id) AS member_count,EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=g.id AND gm.user_id=$1) AS is_member FROM groups g JOIN users u ON u.id=g.created_by ORDER BY g.created_at DESC LIMIT 50`,[req.user.id]);
 res.json({groups:r.rows.map(g=>({id:String(g.id),name:g.name,slug:g.slug,description:g.description,createdAt:g.created_at,creator:{username:g.creator_username,displayName:g.creator_name},memberCount:Number(g.member_count),isMember:g.is_member}))});
}));
app.post("/api/groups", auth, asyncRoute(async(req,res)=>{
 const name=cleanText(req.body.name,80),description=cleanText(req.body.description,500),base=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,75);
 if(name.length<3||!base)return res.status(400).json({error:"Group name must be at least 3 characters."});
 const slug=base+'-'+randomBytes(3).toString('hex');const c=await pool.connect();
 try{await c.query('BEGIN');const r=await c.query('INSERT INTO groups(name,slug,description,created_by) VALUES($1,$2,$3,$4) RETURNING *',[name,slug,description,req.user.id]);await c.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",[r.rows[0].id,req.user.id]);await c.query('COMMIT');const g=r.rows[0];res.status(201).json({group:{id:String(g.id),name:g.name,slug:g.slug,description:g.description,memberCount:1,isMember:true}});}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}));
app.post("/api/groups/:id/join", auth, asyncRoute(async(req,res)=>{
 const g=await pool.query('SELECT id FROM groups WHERE id=$1',[req.params.id]);if(!g.rowCount)return res.status(404).json({error:'Group not found.'});
 const old=await pool.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2',[req.params.id,req.user.id]);
 if(old.rowCount)await pool.query("DELETE FROM group_members WHERE group_id=$1 AND user_id=$2 AND role<>'owner'",[req.params.id,req.user.id]);else await pool.query('INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.params.id,req.user.id]);
 const now=await pool.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2',[req.params.id,req.user.id]);res.json({isMember:!!now.rowCount});
}));
app.get("/api/stories", auth, asyncRoute(async(req,res)=>{
 const r=await pool.query(`SELECT s.id,s.body,s.media_url,s.media_type,s.created_at,s.expires_at,u.id AS user_id,u.username,u.display_name,u.bio,u.avatar_url,u.created_at AS user_created_at FROM stories s JOIN users u ON u.id=s.user_id WHERE s.expires_at>NOW() ORDER BY s.created_at DESC LIMIT 100`);
 res.json({stories:r.rows.map(s=>({id:String(s.id),body:s.body,mediaUrl:s.media_url,mediaType:s.media_type,createdAt:s.created_at,expiresAt:s.expires_at,user:{id:String(s.user_id),username:s.username,displayName:s.display_name,bio:s.bio,avatarUrl:s.avatar_url,createdAt:s.user_created_at}}))});
}));
app.post("/api/stories", auth, asyncRoute(async(req,res)=>{
 const body=cleanText(req.body.body,280),mediaUrl=cleanText(req.body.mediaUrl,500),mediaType=['image','video'].includes(req.body.mediaType)?req.body.mediaType:null;
 if(!body&&!mediaUrl)return res.status(400).json({error:'Add a caption or media to create a story.'});if(mediaUrl&&!mediaUrl.startsWith('/uploads/'))return res.status(400).json({error:'Invalid uploaded media path.'});
 const r=await pool.query('INSERT INTO stories(user_id,body,media_url,media_type) VALUES($1,$2,$3,$4) RETURNING *',[req.user.id,body,mediaUrl||null,mediaUrl?mediaType:null]);const x=r.rows[0];res.status(201).json({story:{id:String(x.id),body:x.body,mediaUrl:x.media_url,mediaType:x.media_type,createdAt:x.created_at,expiresAt:x.expires_at}});
}));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API route not found." });
  res.sendFile(path.join(__dirname, "public", "index.html"), err => { if (err) next(err); });
});
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "File is too large." : "Upload failed." });
  if (err.message?.startsWith("Only JPG")) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: "Something went wrong. Please try again." });
});
const server = app.listen(port, () => console.log(`Circle running at http://localhost:${port}`));
async function shutdown() { server.close(); await pool.end(); process.exit(0); }
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);