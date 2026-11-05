import {useCallback,useEffect,useState} from 'react';
import {useApp} from '../lib/store';
import type {Announcement} from '../lib/api';
import {IconBell} from '../icons';
function readDismissed(key:string):string[]{try{const v=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string').slice(-200):[]}catch{return []}}
export default function GlobalNotifications(){
 const {announce,userId}=useApp();const [items,setItems]=useState<Announcement[]>([]);const [dismissed,setDismissed]=useState<string[]>([]);
 const key=`scs-announcements-dismissed:${userId}`;
 useEffect(()=>{setItems([]);setDismissed(readDismissed(key));},[key]);
 useEffect(()=>{let active=true;let busy=false;const poll=async()=>{if(!userId||busy||document.visibilityState!=='visible')return;busy=true;try{const r=await announce('list');if(active)setItems(Array.isArray(r.announcements)?r.announcements:[])}catch{/* tentativa periódica; sem afirmar que não há avisos */}finally{busy=false}};void poll();const timer=window.setInterval(poll,60000);const visible=()=>{if(document.visibilityState==='visible')void poll()};document.addEventListener('visibilitychange',visible);return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible)}},[announce,userId]);
 const close=useCallback((id:string)=>setDismissed(old=>{const next=[...old,id].slice(-200);try{localStorage.setItem(key,JSON.stringify(next))}catch{}return next}),[key]);
 const visible=items.filter(x=>!dismissed.includes(x.id)&&Date.parse(x.expires_at)>Date.now()).slice(0,3);
 return <div className="global-notifications" aria-label="Comunicados do aplicativo">{visible.map(item=><section className="global-alert" key={item.id} role="status"><span className="global-alert-icon"><IconBell/></span><div><span className="global-alert-kicker">COMUNICADO OFICIAL</span><strong>{item.title}</strong><p>{item.body}</p></div><button type="button" aria-label={`Fechar comunicado ${item.title}`} onClick={()=>close(item.id)}>×</button></section>)}</div>;
}
