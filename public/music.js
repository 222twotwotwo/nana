'use strict';
function musicPageUrl(value) {
  try {const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}
}
async function startMusic(music,resume=true) {
  const request=++player.playRequest;
  player.ensureCtx();
  const progress=getProgress()[music.id],same=player.currentId===music.id;
  if(!same&&music.source&&(music.sourceUrl||music.audio)) {
    const d=(await api('/api/action',{source:music.source,action:'play',value:music.sourceUrl||music.audio})).data;
    if(request!==player.playRequest) return false;
    music={...music,preview:!!d.preview,duration:Number(d.duration||music.duration||0),size:Number(d.size||music.size||0)};
    await dbPut('music',music);
    if(request!==player.playRequest) return false;
  }
  state.muSelected=music;showPage('music');
  const played=await player.crossfadeTo(music);
  if(played) {
    const el=player.activeEl();
    if(!resume) el.currentTime=0;
    else if(!same&&progress?.time>0&&progress.time<el.duration) el.currentTime=progress.time;
    saveMediaProgress(music.id,0,el);
  }
  return played;
}
$('musicDiscover').onclick=()=>openDiscovery('music');
$('musicCollection').onclick=()=>openCategory('music','library');
setInterval(()=>{if(player.currentMusic&&player.isPlaying()) saveMediaProgress(player.currentMusic.id,0,player.activeEl());},1000);
