const $ = s => document.querySelector(s);
let authMode = "login", me = null;
const toastEl = $("#toast");
let toastTimer;
function toast(message) { toastEl.textContent = message; toastEl.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600); }
async function api(url, options = {}) {
  const opts = { credentials: "same-origin", ...options, headers: { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(options.headers || {}) } };
  const response = await fetch(url, opts);
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function setAuthMode(mode) {
  authMode = mode;
  $("#loginTab").classList.toggle("active", mode === "login");
  $("#registerTab").classList.toggle("active", mode === "register");
  $("#nameLabel").classList.toggle("hidden", mode !== "register");
  $("#usernameLabel").classList.toggle("hidden", mode !== "register");
  $("#authSubmit").textContent = mode === "login" ? "Sign in" : "Create account";
  $("#authForm").elements.password.autocomplete = mode === "login" ? "current-password" : "new-password";
  $("#authMessage").textContent = "";
}
$("#loginTab").addEventListener("click", () => setAuthMode("login"));
$("#registerTab").addEventListener("click", () => setAuthMode("register"));
$("#authForm").addEventListener("submit", async e => {
  e.preventDefault(); const form = new FormData(e.currentTarget);
  const payload = Object.fromEntries(form.entries());
  $("#authSubmit").disabled = true; $("#authMessage").textContent = "One moment…";
  try {
    const result = await api(`/api/auth/${authMode === "login" ? "login" : "register"}`, { method: "POST", body: JSON.stringify(payload) });
    me = result.user; showApp(); await loadFeed(); await loadPeople();
  } catch (err) { $("#authMessage").textContent = err.message; }
  finally { $("#authSubmit").disabled = false; }
});
function showApp() {
  $("#authPanel").classList.add("hidden"); $("#appPanel").classList.remove("hidden"); $("#logoutBtn").classList.remove("hidden");
  $("#topUser").textContent = me.displayName; $("#myAvatar").textContent = (me.displayName || "Y").slice(0,1).toUpperCase();
}
$("#logoutBtn").addEventListener("click", async () => { try { await api("/api/auth/logout", {method:"POST"}); } catch {} me = null; $("#appPanel").classList.add("hidden"); $("#authPanel").classList.remove("hidden"); $("#logoutBtn").classList.add("hidden"); $("#topUser").textContent = "Welcome"; toast("Signed out."); });
$("#mediaFile").addEventListener("change", () => { $("#fileName").textContent = $("#mediaFile").files[0]?.name || ""; });
$("#composer").addEventListener("submit", async e => {
  e.preventDefault(); const body = $("#postBody").value.trim(), file = $("#mediaFile").files[0];
  if (!body && !file) return toast("Write a post or choose a photo/video.");
  const submit = e.currentTarget.querySelector("button[type=submit]"); submit.disabled = true; $("#postMessage").textContent = "";
  try {
    let media = {};
    if (file) {
      const form = new FormData(); form.append("media", file);
      media = await api("/api/uploads", { method: "POST", body: form });
    }
    await api("/api/posts", { method: "POST", body: JSON.stringify({ body, ...media }) });
    $("#postBody").value = ""; $("#mediaFile").value = ""; $("#fileName").textContent = "";
    await loadFeed(); toast("Post shared with Circle!");
  } catch (err) { $("#postMessage").textContent = err.message; }
  finally { submit.disabled = false; }
});
function safeText(tag, cls, text) { const el = document.createElement(tag); if (cls) el.className = cls; el.textContent = text ?? ""; return el; }
function renderPost(post) {
  const article = document.createElement("article"); article.className = "card post"; article.dataset.id = post.id;
  const head = document.createElement("div"); head.className = "post-head";
  const avatar = safeText("div","avatar",(post.user.displayName || post.user.username || "?").slice(0,1).toUpperCase());
  const info = document.createElement("div"); info.append(safeText("div","post-name",post.user.displayName), safeText("span","handle",` @${post.user.username}`), safeText("div","post-time",new Date(post.createdAt).toLocaleString()));
  head.append(avatar, info); article.append(head);
  if (post.body) article.append(safeText("p","post-body",post.body));
  if (post.mediaUrl) {
    const media = post.mediaType === "video" ? document.createElement("video") : document.createElement("img");
    media.className = "media"; media.src = post.mediaUrl; media.controls = post.mediaType === "video"; media.alt = "Shared by " + post.user.displayName;
    if (post.mediaType === "image") media.loading = "lazy";
    article.append(media);
  }
  const meta = safeText("div","post-meta",`${post.likes} ${post.likes === 1 ? "like" : "likes"} · ${post.commentCount} ${post.commentCount === 1 ? "comment" : "comments"}`);
  article.append(meta);
  const actions = document.createElement("div"); actions.className = "post-actions";
  const like = safeText("button",post.likedByMe?"liked":"",post.likedByMe?"♥ Liked":"♡ Like");
  like.addEventListener("click",async()=>{like.disabled=true;try{const r=await api(`/api/posts/${post.id}/like`,{method:"POST",body:"{}"});post.likedByMe=r.liked;post.likes=r.likes;like.classList.toggle("liked",r.liked);like.textContent=r.liked?"♥ Liked":"♡ Like";meta.textContent=`${r.likes} ${r.likes===1?"like":"likes"} · ${post.commentCount} ${post.commentCount===1?"comment":"comments"}`;}catch(err){toast(err.message)}finally{like.disabled=false}});
  const commentBtn = safeText("button","","▢ Comments");
  const shareBtn = safeText("button","","↗ Share");
  shareBtn.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(location.origin+`/#post-${post.id}`);toast("Post link copied.");}catch{toast("Copy this page URL to share Us Yup.")}});
  actions.append(like,commentBtn,shareBtn); article.append(actions);
  const area = document.createElement("div"); area.className="comment-area hidden";
  const list = document.createElement("div"); list.className="comment-list";
  const form = document.createElement("form"); form.className="comment-form";
  const input = document.createElement("input"); input.placeholder="Write a comment…"; input.maxLength=1000; input.required=true;
  const send = safeText("button","primary","Send"); send.type="submit"; form.append(input,send); area.append(list,form); article.append(area);
  let commentsLoaded=false;
  commentBtn.addEventListener("click",async()=>{area.classList.toggle("hidden");if(!area.classList.contains("hidden")&&!commentsLoaded){try{const r=await api(`/api/posts/${post.id}/comments`);r.comments.forEach(c=>list.append(renderComment(c)));commentsLoaded=true;}catch(err){toast(err.message)}}});
  form.addEventListener("submit",async e=>{e.preventDefault();const body=input.value.trim();if(!body)return;send.disabled=true;try{const r=await api(`/api/posts/${post.id}/comments`,{method:"POST",body:JSON.stringify({body})});list.append(renderComment(r.comment));input.value="";post.commentCount++;meta.textContent=`${post.likes} ${post.likes===1?"like":"likes"} · ${post.commentCount} ${post.commentCount===1?"comment":"comments"}`;}catch(err){toast(err.message)}finally{send.disabled=false}});
  return article;
}
function renderComment(c){const div=document.createElement("div");div.className="comment";const name=safeText("strong","",c.user?.displayName||c.user?.username||"Member");div.append(name,document.createTextNode(c.body));return div;}
async function loadFeed() {
  const feed=$("#feed"); feed.replaceChildren(safeText("div","card empty","Loading posts…"));
  try { const r=await api("/api/posts"); feed.replaceChildren(); if(!r.posts.length){feed.append(safeText("div","card empty","No posts yet. Be the first to share something with Us Yup."));return;} r.posts.forEach(p=>feed.append(renderPost(p))); }
  catch(err){feed.replaceChildren(safeText("div","card empty",err.message));}
}
async function loadPeople(query="") {
  const host=$("#people"); if(!me){host.replaceChildren(safeText("p","muted small","Sign in to discover people."));return;}
  try {
    const r=await api("/api/users?q="+encodeURIComponent(query));host.replaceChildren();
    if(!r.users.length){host.append(safeText("p","muted small","No other members found yet."));return;}
    r.users.slice(0,8).forEach(u=>{
      const row=document.createElement("div");row.className="person";
      row.append(safeText("div","avatar",(u.displayName||u.username).slice(0,1).toUpperCase()));
      const info=document.createElement("div");info.className="person-info";info.append(safeText("b","",u.displayName),safeText("span","",`@${u.username}`));
      const button=safeText("button",u.isFollowing?"follow following":"follow",u.isFollowing?"Following":"Follow");
      button.addEventListener("click",async()=>{button.disabled=true;try{const out=await api(`/api/users/${u.id}/follow`,{method:"POST",body:"{}"});u.isFollowing=out.following;button.textContent=out.following?"Following":"Follow";button.classList.toggle("following",out.following);}catch(err){toast(err.message)}finally{button.disabled=false}});
      row.append(info,button);host.append(row);
    });
  } catch(err){host.replaceChildren(safeText("p","muted small",err.message));}
}
let searchTimer;
$("#search").addEventListener("input",e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadPeople(e.target.value.trim()),250)});
async function boot(){try{const r=await api("/api/me");me=r.user;showApp();await Promise.all([loadFeed(),loadPeople(),loadStories()]);}catch{setAuthMode("login");}}
// Us Yup feature panels: groups, stories, notifications, messaging, and live-video roadmap.
async function loadStories() {
  const host = document.querySelector('#stories'); if (!host) return; host.replaceChildren();
  try {
    const r = await api('/api/stories');
    if (!r.stories.length) { host.append(safeText('span','muted small','No stories yet — add the first one.')); return; }
    r.stories.forEach(st => {
      const chip = safeText('div','story-chip','');
      const ring = safeText('div','story-ring',''); const inner = safeText('div','story-inner','');
      if (st.mediaUrl) { const m = st.mediaType === 'video' ? document.createElement('video') : document.createElement('img'); m.src=st.mediaUrl; m.muted=true; inner.append(m); }
      else inner.textContent=(st.user.displayName||'?').slice(0,1).toUpperCase();
      ring.append(inner); chip.append(ring,safeText('div','',st.user.displayName||st.user.username));
      chip.addEventListener('click',()=>showStory(st)); host.append(chip);
    });
  } catch (e) { host.append(safeText('span','muted small',e.message)); }
}
function showStory(st) {
  const panel=document.querySelector('#featurePanel'); panel.classList.remove('hidden'); panel.replaceChildren(safeText('h2','','Story from '+(st.user.displayName||st.user.username)));
  const view=safeText('div','story-view','');
  if(st.mediaUrl){const m=st.mediaType==='video'?document.createElement('video'):document.createElement('img');m.src=st.mediaUrl;m.controls=st.mediaType==='video';view.append(m);}
  if(st.body)view.append(safeText('p','',st.body)); view.append(safeText('small','',`Expires ${new Date(st.expiresAt).toLocaleString()}`));panel.append(view);panel.scrollIntoView({behavior:'smooth',block:'start'});
}
async function addStory() {
  const body=prompt('Add a short story caption (or leave blank if adding media):'); if(body===null)return;
  const fileInput=document.createElement('input');fileInput.type='file';fileInput.accept='image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime';
  if(confirm('Attach a photo or video? Choose Cancel to post text only.')) {
    fileInput.onchange=async()=>{const file=fileInput.files[0];if(!file)return;try{const fd=new FormData();fd.append('media',file);const media=await api('/api/uploads',{method:'POST',body:fd});await publishStory(body,media);}catch(e){toast(e.message);}};fileInput.click();
  } else await publishStory(body,{});
}
async function publishStory(body,media){try{await api('/api/stories',{method:'POST',body:JSON.stringify({body,...media})});await loadStories();toast('Story added for 24 hours.');}catch(e){toast(e.message);}}
document.querySelector('#storyBtn')?.addEventListener('click',addStory);
function openFeature(name){
  const panel=document.querySelector('#featurePanel'),feed=document.querySelector('#feed');panel.classList.remove('hidden');panel.replaceChildren();feed.classList.toggle('hidden',name!=='feed');
  const titles={groups:'Groups & communities',messages:'Private messages',notifications:'Notifications',live:'Live video'};
  if(name==='feed'){panel.classList.add('hidden');return;}panel.append(safeText('h2','',titles[name]||'Us Yup'));panel.scrollIntoView({behavior:'smooth',block:'start'});
  if(name==='groups')renderGroups(panel); if(name==='messages')renderMessages(panel); if(name==='notifications')renderNotifications(panel);
  if(name==='live'){const box=safeText('div','live-card','');box.append(safeText('h3','','Go live with your people'),safeText('p','','Live video is not enabled in this version. A real launch needs WebRTC, a signaling server, STUN/TURN services, access controls, and moderation. This is a roadmap panel, not a live stream.'));panel.append(box);}
}
async function renderGroups(panel){
 const form=document.createElement('form');form.className='inline-form';const name=document.createElement('input');name.placeholder='Community name';name.minLength=3;name.maxLength=80;name.required=true;const desc=document.createElement('input');desc.placeholder='Short description';desc.maxLength=500;const submit=safeText('button','primary','Create group');submit.type='submit';form.append(name,desc,submit);panel.append(form);
 const list=safeText('div','feature-grid','');panel.append(list);
 form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;try{await api('/api/groups',{method:'POST',body:JSON.stringify({name:name.value,description:desc.value})});name.value='';desc.value='';toast('Community created.');await refreshGroups(list);}catch(err){toast(err.message);}finally{submit.disabled=false;}});
 await refreshGroups(list);
}
async function refreshGroups(list){try{const r=await api('/api/groups');list.replaceChildren();if(!r.groups.length){list.append(safeText('p','muted small','No communities yet. Create the first one!'));return;}r.groups.forEach(g=>{const item=safeText('div','feature-item','');item.append(safeText('b','',g.name),safeText('p','',g.description||'A community on Us Yup.'),safeText('p','small',`${g.memberCount} members`));const b=safeText('button',g.isMember?'secondary':'primary',g.isMember?'Joined':'Join group');b.addEventListener('click',async()=>{try{const x=await api(`/api/groups/${g.id}/join`,{method:'POST',body:'{}'});g.isMember=x.isMember;b.textContent=x.isMember?'Joined':'Join group';b.className=x.isMember?'secondary':'primary';await refreshGroups(list);}catch(err){toast(err.message);}});item.append(b);list.append(item);});}catch(err){list.append(safeText('p','',err.message));}}
async function renderNotifications(panel){const list=safeText('div','','');panel.append(list);const b=safeText('button','secondary','Mark all as read');b.addEventListener('click',async()=>{try{await api('/api/notifications/read',{method:'POST',body:'{}'});await refreshNotifications(list);toast('Notifications marked as read.');}catch(e){toast(e.message);}});panel.append(b);await refreshNotifications(list);}
async function refreshNotifications(list){try{const r=await api('/api/notifications');list.replaceChildren();if(!r.notifications.length){list.append(safeText('p','muted small',"You're all caught up."));return;}r.notifications.forEach(n=>{const row=safeText('div','notification-row','');row.append(safeText('div','',n.body),safeText('small','',new Date(n.createdAt).toLocaleString()+(n.readAt?' · Read':' · New')));list.append(row);});}catch(e){list.append(safeText('p','',e.message));}}
async function renderMessages(panel){
 panel.append(safeText('p','muted small','Choose a member to open a private conversation. Messages are stored by the server; realtime delivery is not included yet.'));
 const select=document.createElement('select');select.style.cssText='width:100%;padding:11px;border:1px solid var(--line);border-radius:10px;margin:10px 0';select.add(new Option('Choose a person…',''));panel.append(select);const host=safeText('div','feature-item','');panel.append(host);
 try{const r=await api('/api/users');r.users.forEach(u=>select.add(new Option(`${u.displayName} (@${u.username})`,u.id)));}catch(e){toast(e.message);}select.addEventListener('change',()=>loadConversation(select.value,host));
}
async function loadConversation(userId,host){host.replaceChildren();if(!userId)return;try{const r=await api(`/api/messages/${userId}`);r.messages.forEach(m=>host.append(safeText('p','',`${m.senderId===String(me.id)?'You':'Them'}: ${m.body}`)));const form=document.createElement('form');form.className='inline-form';const input=document.createElement('input');input.placeholder='Write a private message…';input.maxLength=4000;input.required=true;const send=safeText('button','primary','Send');send.type='submit';form.append(input,send);host.append(form);form.addEventListener('submit',async e=>{e.preventDefault();send.disabled=true;try{await api(`/api/messages/${userId}`,{method:'POST',body:JSON.stringify({body:input.value})});input.value='';await loadConversation(userId,host);toast('Message sent.');}catch(err){toast(err.message);}finally{send.disabled=false;}});}catch(e){host.append(safeText('p','',e.message));}}
document.querySelector('#groupsNav')?.addEventListener('click',()=>openFeature('groups'));
document.querySelector('#messagesNav')?.addEventListener('click',()=>openFeature('messages'));
document.querySelector('#notificationsNav')?.addEventListener('click',()=>openFeature('notifications'));
document.querySelector('#liveNav')?.addEventListener('click',()=>openFeature('live'));
document.querySelector('#peopleNav')?.addEventListener('click',()=>{document.querySelector('#search').focus();toast('Search for members in the top bar.');});
document.querySelector('#storiesNav')?.addEventListener('click',()=>document.querySelector('#stories').scrollIntoView({behavior:'smooth'}));
document.querySelector('.sidebar .nav.active')?.addEventListener('click',()=>{openFeature('feed');window.scrollTo({top:0,behavior:'smooth'});});
// Start after all feature handlers have been registered.
boot();
