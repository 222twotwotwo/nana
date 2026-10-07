'use strict';
const MoyinBackup = {
  async open() {
    return new Promise((resolve,reject)=>{
      const r=indexedDB.open('novel-reader',1);
      r.onupgradeneeded=()=>{
        for(const [name,keyPath] of [['books','id'],['music','id'],['analyses','key']])
          if(!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name,{keyPath});
      };
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    });
  },
  async export() {
    const db=await this.open(),data={format:'moyin-backup',version:1,exportedAt:new Date().toISOString(),stores:{},settings:{}};
    try {
      for(const name of ['books','music','analyses']) {
        data.stores[name]=await new Promise((resolve,reject)=>{
          const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
        });
      }
      for(const music of data.stores.music) {
        if(music.blob) music.audio=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(music.blob);});
        delete music.blob;
      }
      for(const key of ['nr-settings','nr-progress','nr-mapping']) {
        const raw=localStorage.getItem(key);if(raw) data.settings[key]=JSON.parse(raw);
      }
      if(data.settings['nr-settings']) delete data.settings['nr-settings'].apiKey;
      const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='moyin-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),10000);
      return data.stores.books.length;
    }finally{db.close();}
  },
  async read(file) {
    if(file.size>200*1024*1024) throw new Error('备份超过 200 MB');
    const data=JSON.parse(await file.text());
    if(data.format!=='moyin-backup'||data.version!==1) throw new Error('不是nana备份文件');
    for(const name of ['books','music','analyses']) {
      if(!Array.isArray(data.stores?.[name])) throw new Error('备份结构不完整');
      for(const row of data.stores[name]) {
        const key=name==='analyses'?row.key:row.id;
        if(typeof key!=='string'||!/^[\w:.-]{1,150}$/.test(key)) throw new Error('备份含无效记录编号');
        if(name==='books'&&(!Array.isArray(row.chapters)||!row.chapters.length||typeof row.title!=='string')) throw new Error('备份含无效书籍');
      }
    }
    return data;
  },
  async restore(data) {
    for(const music of data.stores.music) {
      if(music.sourceUrl) {
        const rules={
          'netease-music':/^https:\/\/music\.163\.com\/song\?id=\d+$/,
          htqyy:/^http:\/\/www\.htqyy\.com\/play\/\d+$/,
          'archive-audio':/^https:\/\/archive\.org\/download\/[^/]+\/.+/,
          'wikimedia-audio':/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/.+/
        };
        if(!rules[music.source]?.test(music.sourceUrl)) throw new Error('备份含无效音乐来源');
        // Expiring media addresses are resolved again from the stable source URL.
        delete music.audio;
      }
      if(music.audio) {
        if(/^data:(audio\/[\w.+-]+|application\/octet-stream);base64,/.test(music.audio)) {
          const [header,encoded]=music.audio.split(','),bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
          music.blob=new Blob([bytes],{type:header.slice(5).split(';')[0]});delete music.audio;
        } else if(!/^https:\/\/(?:archive\.org\/download\/|upload\.wikimedia\.org\/)/.test(music.audio)) {
          throw new Error('备份含无效音频');
        }
      }
    }
    const db=await this.open();
    try {
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(['books','music','analyses'],'readwrite');
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);
        for(const name of ['books','music','analyses']) for(const row of data.stores[name]) tx.objectStore(name).put(row);
      });
      for(const key of ['nr-settings','nr-progress','nr-mapping']) {
        if(data.settings?.[key]&&typeof data.settings[key]==='object') {
          const current=JSON.parse(localStorage.getItem(key)||'{}');
          localStorage.setItem(key,JSON.stringify({...current,...data.settings[key]}));
        }
      }
    }finally{db.close();}
  }
};
