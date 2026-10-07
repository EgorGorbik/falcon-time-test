import { getChatGPTUser } from '../../chatgpt-auth';
import { db,query,first,run,token,codeHash,audit,allSessions,controlState,auditStatement,eventStatement } from '@/lib/server';
import { clipSessions,periodBounds,localDate,duration } from '@/lib/time';
import { payCents, isTrc20, isTronTx, MAX_HOURLY_CENTS } from '@/lib/pay';
import { personDays, isWorkUrl } from '@/lib/team-plan';
import { ingestEvents } from '@/lib/ingest';
import { deviceHealth } from '@/lib/tracking';
import { dailyBackup,createBackup,backupData } from '@/lib/backup';
export const dynamic='force-dynamic';
import {fail,json,field,readBody,checkMethod,apiBoundary} from '@/lib/http';
import {authenticate,publicAuth,safePerson} from '@/lib/auth';
import {readiness} from '@/lib/readiness';
async function handle(req:Request){
 const platform=await getChatGPTUser();if(!platform)return json({error:'Войдите через ChatGPT',signin:true},401);
 const url=new URL(req.url),path=url.pathname.replace(/^\/api\//,'');const method=req.method;
 checkMethod(path,method);
 const account=await first('SELECT value FROM settings WHERE key=?','account');if(account&&account.value!==platform.userId)fail('Этот кабинет подключён к другому аккаунту ChatGPT',403);
 const b=await readBody(req);const publicResult=await publicAuth(path,b,platform);if(publicResult)return publicResult;
 const {loginHash,me}=await authenticate(req,platform.userId);const admin=me.role==='owner'||me.role==='admin';const needAdmin=()=>{if(!admin)fail('Требуются права администратора',403);};
 if(path==='readiness'){needAdmin();const status=await readiness();return json(status,status.ready?200:503);}
 if(path==='me'&&method==='GET')return json({me,accountConnected:!!account,serverTime:Date.now()});
 if(path==='logout'&&method==='POST'){
  await db().batch([eventStatement(me.id,'web','none','stop',Date.now()),db().prepare('DELETE FROM logins WHERE hash=?').bind(loginHash)]);
  return json({ok:true},200,{'Set-Cookie':'falcon_profile=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'});
 }
 if(path==='extension-state'&&method==='GET'){const deviceId=url.searchParams.get('device');if(deviceId&&!await first('SELECT id FROM devices WHERE id=? AND person_id=? AND active=1',deviceId,me.id))fail('Устройство отключено. Подключите его заново.',403);const control=await controlState(me.id);return json({me,projects:await query('SELECT * FROM projects WHERE active=1'),paused:!!control&&control.kind!=='resume',serverTime:Date.now()});}
 if(path==='profile'&&method==='POST'){
  const name=field(b.name),email=field(b.email,200).toLowerCase(),job=field(b.job),timezone=field(b.timezone,80),equipment=field(b.equipment,200);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Проверьте почту');
  try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{fail('Проверьте часовой пояс');}
  if(b.consent!==true)fail('Подтвердите подключение учёта');
  await db().batch([
   db().prepare('UPDATE login_codes SET used=1 WHERE person_id=? AND EXISTS (SELECT 1 FROM people WHERE id=? AND email<>?)').bind(me.id,me.id,email),
   db().prepare('UPDATE people SET name=?,email=?,job=?,timezone=?,equipment=?,onboarded=1 WHERE id=?').bind(name,email,job,timezone,equipment,me.id),
   ...(!me.onboarded?[eventStatement(me.id,'web','none','resume',Date.now())]:[]),
   auditStatement(me.id,'profile',me.id,{name})
  ]);return json({ok:true});
 }
 if(path==='data'&&method==='GET'){const people=admin?await query('SELECT * FROM people ORDER BY created,id'):[me];const ids=people.map(p=>p.id);const projects=await query('SELECT * FROM projects ORDER BY name');const devices=admin?await query('SELECT * FROM devices ORDER BY created'):await query('SELECT * FROM devices WHERE person_id=? ORDER BY created',me.id);const period=url.searchParams.get('period')||'day';if(!['day','week','month','year'].includes(period))fail('Неверный период');const date=url.searchParams.get('date')||localDate(Date.now());if(!/^\d{4}-\d{2}-\d{2}$/.test(date))fail('Неверная дата');if(Number.isNaN(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)fail('Неверная дата');const bounds=periodBounds(period,date);const all=await allSessions(ids);const review=admin?await query("SELECT * FROM review_events WHERE status='pending' ORDER BY created DESC LIMIT 200"):await query("SELECT * FROM review_events WHERE person_id=? AND status='pending' ORDER BY created DESC LIMIT 200",me.id);const tracking=Object.fromEntries(await Promise.all(ids.map(async id=>{const c=await controlState(id);return [id,{paused:!!c&&c.kind!=='resume',at:c?.at}]})));const payouts=ids.length?await query(`SELECT id,person_id,period,range_from,range_to,milliseconds,hourly_rate,amount,wallet,status,tx_hash,created,updated FROM payouts WHERE period=? AND range_from=? AND person_id IN (${ids.map(()=>'?').join(',')}) ORDER BY created`,period,bounds.from,...ids):[];const since=Math.min(bounds.from,Date.now()-45*86400000);const placeholders=ids.map(()=>'?').join(',');const absences=ids.length?await query(`SELECT person_id, day, note, created FROM absences WHERE day>=? AND person_id IN (${placeholders})`,localDate(since),...ids):[];const links=ids.length?await query(`SELECT id, person_id, day, url, note, created FROM work_links WHERE day>=? AND person_id IN (${placeholders}) ORDER BY created DESC LIMIT 200`,localDate(since),...ids):[];const days=personDays(people,all,absences,Date.now());return json({review,tracking,payouts,days,absences,links,backups:admin?await query('SELECT id,created,checksum,bytes,verified FROM backups ORDER BY created DESC LIMIT 10'):[],backupError:admin?(await first("SELECT value FROM settings WHERE key='backup-error'"))?.value:null,me,people:people.map(safePerson),projects,devices:devices.map(d=>({...d,...deviceHealth(d,Date.now())})),sessions:clipSessions(all,bounds.from,bounds.to).map(({event_ids,...s})=>s),current:all.filter(s=>s.open).map(({event_ids,...s})=>s),bounds,serverTime:Date.now(),audit:admin?await query('SELECT a.*,p.name as actor_name FROM audit a LEFT JOIN people p ON a.actor=p.id ORDER BY at DESC LIMIT 30'):[]});}
 if(path==='projects'&&method==='POST'){
  needAdmin();const name=field(b.name,100),id=b.id?field(b.id,80):crypto.randomUUID();
  if(b.active!==undefined&&typeof b.active!=='boolean')fail('Неверное состояние проекта');
  if(id==='none')fail('Нельзя менять системный проект');
  if(b.id&&!await first('SELECT id FROM projects WHERE id=?',id))fail('Проект не найден',404);
  let budget: number | null = null;
  if(b.budgetCents!==undefined && b.budgetCents!==null && b.budgetCents!==''){
    budget=Number(b.budgetCents);
    if(!Number.isInteger(budget)||budget<0||budget>100_000_000)fail('Лимит проекта — целое число центов USDT');
  }
  const active=b.active===false?0:1;
  await db().batch([b.id?(budget===null?db().prepare('UPDATE projects SET name=?,active=? WHERE id=?').bind(name,active,id):db().prepare('UPDATE projects SET name=?,active=?,budget_cents=? WHERE id=?').bind(name,active,budget,id)):db().prepare('INSERT INTO projects (id,name,active,budget_cents) VALUES (?,?,?,?)').bind(id,name,active,budget??0),auditStatement(me.id,'project',id,{name,active:b.active!==false,budget})]);
  return json({ok:true,id});
 }
 if(path==='people'&&method==='POST'){
  needAdmin();const id=b.id?field(b.id,80):crypto.randomUUID(),name=field(b.name);
  if(!['admin','member'].includes(b.role))fail('Неверная роль');
  if(b.active!==undefined&&typeof b.active!=='boolean')fail('Неверное состояние сотрудника');
  const existing=await first('SELECT * FROM people WHERE id=?',id);
  if(b.id&&!existing)fail('Сотрудник не найден',404);
  if(existing?.role==='owner')fail('Профиль владельца изменяется только владельцем в личной анкете',403);
  if(existing?.id===me.id&&(b.active===false||b.role!==me.role))fail('Нельзя отключить себя или изменить собственную роль');
  const active=b.active===false?0:1;
  await db().batch([
   existing?db().prepare('UPDATE people SET name=?,role=?,active=?,auth_version=auth_version+? WHERE id=?').bind(name,b.role,active,active?0:1,id):db().prepare('INSERT INTO people (id,name,role,active,created) VALUES (?,?,?,?,?)').bind(id,name,b.role,active,Date.now()),
   ...(active?[]:[db().prepare('DELETE FROM logins WHERE person_id=?').bind(id),db().prepare('UPDATE login_codes SET used=1 WHERE person_id=?').bind(id),db().prepare('UPDATE devices SET active=0 WHERE person_id=?').bind(id),eventStatement(id,'admin','none','revoke',Date.now())]),
   auditStatement(me.id,'person',id,{name,role:b.role,active:!!active})
  ]);return json({ok:true,id});
 }
 if(path==='access-code'&&method==='POST'){
  needAdmin();const id=field(b.id,80);const target=await first('SELECT * FROM people WHERE id=?',id);
  if(!target)fail('Сотрудник не найден',404);
  if(target.role==='owner'&&me.role!=='owner')fail('Код владельца меняет только владелец',403);
  const code=token().slice(0,20),digest=await codeHash(code);
  await db().batch([
   db().prepare('UPDATE people SET code_hash=?,auth_version=auth_version+1 WHERE id=?').bind(digest,id),
   db().prepare('DELETE FROM logins WHERE person_id=? AND hash<>?').bind(id,loginHash),
   db().prepare('UPDATE logins SET auth_version=(SELECT auth_version FROM people WHERE id=?) WHERE person_id=? AND hash=?').bind(id,id,loginHash),
   db().prepare('UPDATE login_codes SET used=1 WHERE person_id=?').bind(id),
   db().prepare('UPDATE devices SET active=0 WHERE person_id=?').bind(id),
   eventStatement(id,'admin','none','stop',Date.now()),
   auditStatement(me.id,'rotate-code',id,{sessionsRevoked:true,emailCodesRevoked:true})
  ]);return json({code,name:target.name,id});
 }
 if(path==='devices'&&method==='POST'){if(!me.onboarded)fail('Сначала заполните личную анкету');const id=crypto.randomUUID();await run('INSERT INTO devices (id,person_id,name,created) VALUES (?,?,?,?)',id,me.id,field(b.name),Date.now());return json({id,personId:me.id,name:me.name,serverTime:Date.now()});}
 if(path==='device/revoke'&&method==='POST'){
  const d=await first('SELECT * FROM devices WHERE id=?',field(b.id,80));if(!d||(!admin&&d.person_id!==me.id))fail('Нет доступа',403);
  await db().batch([db().prepare('UPDATE devices SET active=0 WHERE id=?').bind(d.id),eventStatement(d.person_id,d.id,'none','device-stop',Date.now()),auditStatement(me.id,'device-revoke',d.id,{})]);return json({ok:true});
 }
 if(path==='tracking'&&method==='POST'){if(b.personId&&b.personId!==me.id)fail('Выбран другой сотрудник',403);if(!me.onboarded)fail('Сначала заполните анкету');if(!['stop','resume'].includes(b.action))fail('Неверное действие');const kind=b.action;let at=Date.now();if(kind==='stop'&&b.at!==undefined){const d=await first('SELECT id FROM devices WHERE id=? AND person_id=? AND active=1',field(b.deviceId,80),me.id);if(!d||!Number.isSafeInteger(b.at)||b.at>at+5000||b.at<at-7*86400000)fail('Проверьте устройство и время остановки');at=Math.min(at,b.at);}await db().batch([eventStatement(me.id,'web','none',kind,at),auditStatement(me.id,'tracking-'+kind,me.id,{})]);return json({ok:true});}
 if(path==='heartbeat'&&method==='POST'){if(!me.onboarded)fail('Заполните анкету');const d=await first('SELECT id FROM devices WHERE id=? AND person_id=? AND active=1',field(b.deviceId,80),me.id);if(!d||b.personId!==me.id)fail('Устройство отключено или выбран другой сотрудник',403);const count=(n:any)=>Number.isSafeInteger(n)&&n>=0?Math.min(n,30000):0;await run('UPDATE devices SET last_seen=?,pending_count=?,review_count=?,status=?,extension_version=?,clock_offset=? WHERE id=?',Date.now(),count(b.pending),count(b.quarantine),['ok','clock','auth','paused'].includes(b.status)?b.status:'ok',typeof b.version==='string'?b.version.slice(0,30):'',Number.isFinite(b.offset)?Math.round(b.offset):0,d.id);await dailyBackup();return json({ok:true,serverTime:Date.now()});}
 if(path==='events'&&method==='POST'){if(!me.onboarded)fail('Заполните анкету');const device=await first('SELECT * FROM devices WHERE id=? AND person_id=? AND active=1',field(b.deviceId,80),me.id);if(!device||b.personId!==me.id)fail('Устройство отключено или выбран другой сотрудник',403);if(!Array.isArray(b.events)||b.events.length>100||b.events.some((e:any)=>!e||typeof e.id!=='string'||!e.id||e.id.length>80))fail('Неверный пакет событий');const result=await ingestEvents(me.id,device,b.events);await run('UPDATE devices SET last_seen=? WHERE id=?',Date.now(),device.id);return json({ok:true,...result});}
 if(path==='review'&&method==='POST'){
  needAdmin();const id=field(b.id,80),resolution=field(b.reason,500);
  const item=await first("SELECT * FROM review_events WHERE id=? AND status='pending'",id);if(!item)fail('Событие уже рассмотрено',409);
  if(!['dismiss','accept'].includes(b.action))fail('Неверное решение');
  let result;
  if(b.action==='accept'){
   const at=b.at;if(!Number.isSafeInteger(at)||at>Date.now()||at<Date.now()-7*86400000)fail('Время должно быть в пределах последних семи дней');
   const access=await first('SELECT d.active AS device_active,d.created,p.active AS person_active FROM devices d JOIN people p ON p.id=d.person_id WHERE d.id=?',item.device_id);
   if(!access?.device_active||!access.person_active)fail('Доступ сотрудника или устройства отозван');
   if(at<access.created-5000)fail('Событие раньше подключения устройства');
   const stop=await controlState(item.person_id,at);if(stop&&stop.kind!=='resume')fail('В это время учёт был остановлен');
   result=await db().batch([
    db().prepare(`INSERT INTO events (id,person_id,device_id,project_id,kind,at,received)
      SELECT r.id,r.person_id,r.device_id,r.project_id,'activity',?,MAX(?,COALESCE((SELECT MAX(received)+1 FROM events WHERE person_id=r.person_id),?))
      FROM review_events r JOIN devices d ON d.id=r.device_id JOIN people p ON p.id=r.person_id
      WHERE r.id=? AND r.status='pending' AND d.active=1 AND p.active=1
      AND COALESCE((SELECT kind FROM events WHERE person_id=r.person_id AND kind IN ('stop','resume','revoke') AND at<=? ORDER BY at DESC,received DESC,id DESC LIMIT 1),'resume')='resume'`).bind(at,Date.now(),Date.now(),id,at),
    db().prepare("UPDATE review_events SET status='accepted',resolved=?,actor=?,resolution=? WHERE id=? AND status='pending' AND changes()>0").bind(Date.now(),me.id,resolution,id),
    auditStatement(me.id,'review-accept',id,{reason:resolution,at},true)
   ]);
  }else result=await db().batch([
   db().prepare("UPDATE review_events SET status='dismissed',resolved=?,actor=?,resolution=? WHERE id=? AND status='pending'").bind(Date.now(),me.id,resolution,id),
   auditStatement(me.id,'review-dismiss',id,{reason:resolution},true)
  ]);
  if(!result[0].meta.changes)fail('Событие уже рассмотрено или доступ изменён. Обновите список.',409);
  return json({ok:true});
 }
 if(path==='backup'&&method==='POST'){needAdmin();const saved=await createBackup();await audit(me.id,'backup',saved.id,{});return json(saved);}
 if(path==='backup/download'&&method==='GET'){if(me.role!=='owner')fail('Резервную базу скачивает только владелец',403);const {body}=await backupData(field(url.searchParams.get('id'),80));return new Response(body,{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Content-Disposition':'attachment; filename="Falcon-Time-backup.json"'}});}
 if(path==='manual'&&method==='POST'){needAdmin();const personId=field(b.personId,80),projectId=field(b.projectId,80),reason=field(b.reason,500),start=Number(b.start),end=Number(b.end);if(!await first('SELECT id FROM people WHERE id=?',personId)||!await first('SELECT id FROM projects WHERE id=?',projectId))fail('Сотрудник или проект не найден');if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start||end>Date.now()||start<0)fail('Проверьте начало и конец');const sessions=await allSessions([personId]);if(sessions.some(x=>x.start<end&&x.end>start))fail('Время пересекается с существующей сессией');const id='manual-'+crypto.randomUUID();const r=await db().batch([db().prepare('INSERT INTO corrections (session_id,person_id,project_id,start,end,original_start,original_end,reason,actor,updated) SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM corrections WHERE person_id=? AND start<? AND end>?)').bind(id,personId,projectId,start,end,start,end,reason,me.id,Date.now(),personId,end,start),auditStatement(me.id,'manual-time',id,{personId,projectId,start,end,reason},true)]);if(!r[0].meta.changes)fail('Другой администратор добавил пересекающийся интервал',409);return json({ok:true,id});}
 if(path==='correction'&&method==='POST'){needAdmin();const id=field(b.sessionId,80),reason=field(b.reason,500);const s=await first('SELECT person_id FROM events WHERE id=? UNION SELECT person_id FROM session_archive WHERE id=? UNION SELECT person_id FROM corrections WHERE session_id=? LIMIT 1',id,id,id);if(!s)fail('Сессия не найдена',404);const start=Number(b.start),end=Number(b.end);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>Date.now())fail('Проверьте начало и конец');const sessions=await allSessions([s.person_id]);const original=sessions.find(x=>x.id===id);if(!original||original.open)fail('Исправлять можно только завершённую сессию');if(sessions.some(x=>x.id!==id&&x.start<end&&x.end>start))fail('Время пересекается с другой сессией');const changedAt=Date.now();const changeId=crypto.randomUUID();const result=await db().batch([
 db().prepare('INSERT INTO corrections (session_id,person_id,project_id,start,end,original_start,original_end,reason,actor,updated) SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM corrections WHERE person_id=? AND session_id<>? AND start<? AND end>?) ON CONFLICT(session_id) DO UPDATE SET start=excluded.start,end=excluded.end,reason=excluded.reason,actor=excluded.actor,updated=excluded.updated').bind(id,s.person_id,original!.project_id,start,end,original!.originalStart||original!.start,original!.originalEnd||original!.end,reason,me.id,changedAt,s.person_id,id,end,start),
 db().prepare('INSERT INTO audit (id,actor,action,target,detail,at) SELECT ?,?,?,?,?,? WHERE changes()>0').bind(changeId,me.id,'correction',id,JSON.stringify({before:original,after:{start,end},reason}),changedAt)
 ]);if(!result[0].meta.changes)fail('Другой администратор изменил пересекающуюся сессию. Обновите журнал.',409);return json({ok:true});}
 if(path==='pay/rate'&&method==='POST'){
  needAdmin();
  const id=field(b.id,80);
  const target=await first('SELECT * FROM people WHERE id=? AND active=1',id);
  if(!target)fail('Сотрудник не найден',404);
  if(target.role==='owner'&&me.role!=='owner')fail('Ставку владельца меняет только владелец',403);
  if(!Number.isInteger(b.hourlyRate)||b.hourlyRate<0||b.hourlyRate>MAX_HOURLY_CENTS)fail('Ставка: от 0 до 1000 USDT в час, с точностью до цента');
  const wallet=typeof b.wallet==='string'?b.wallet.trim():fail('Проверьте адрес USDT');
  if(wallet&&!isTrc20(wallet))fail('Адрес USDT TRC-20 должен начинаться с T и содержать 34 символа');
  await db().batch([
   db().prepare('UPDATE people SET hourly_rate=?,wallet_trc20=? WHERE id=?').bind(b.hourlyRate,wallet,id),
   auditStatement(me.id,'pay-rate',id,{hourlyRate:b.hourlyRate,wallet:wallet?wallet.slice(0,6)+'…':''})
  ]);
  return json({ok:true});
 }
 if(path==='pay/prepare'&&method==='POST'){
  needAdmin();
  const personId=field(b.personId,80);
  if(!['day','week','month','year'].includes(b.period))fail('Неверный период');
  const date=field(b.date,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))fail('Неверная дата');
  const person=await first('SELECT * FROM people WHERE id=? AND active=1',personId);
  if(!person)fail('Сотрудник не найден',404);
  if(!person.hourly_rate)fail('Сначала задайте ставку');
  if(!isTrc20(person.wallet_trc20||''))fail('Сначала укажите адрес USDT TRC-20');
  const bounds=periodBounds(b.period,date);
  const existing=await first('SELECT status FROM payouts WHERE person_id=? AND period=? AND range_from=?',personId,b.period,bounds.from);
  if(existing?.status==='paid')fail('Этот период уже оплачен',409);
  if(existing?.status==='awaiting')fail('Выплата уже подготовлена и ждёт подтверждения в Trust Wallet',409);
  const milliseconds=duration(clipSessions(await allSessions([personId]),bounds.from,bounds.to));
  const amount=payCents(milliseconds,person.hourly_rate);
  if(amount<=0)fail('За период нет оплачиваемого времени');
  const id=crypto.randomUUID(),at=Date.now();
  await db().batch([
   db().prepare('INSERT INTO payouts (id,person_id,period,range_from,range_to,milliseconds,hourly_rate,amount,wallet,status,actor,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,personId,b.period,bounds.from,bounds.to,milliseconds,person.hourly_rate,amount,person.wallet_trc20,'awaiting',me.id,at,at),
   auditStatement(me.id,'pay-prepare',id,{personId,period:b.period,amount,wallet:person.wallet_trc20})
  ]);
  return json({ok:true,id,amount,milliseconds});
 }
 if(path==='pay/confirm'&&method==='POST'){
  needAdmin();
  const id=field(b.id,80),tx=field(b.txHash,64);
  if(!isTronTx(tx))fail('Хеш транзакции TRON — 64 шестнадцатеричных символа');
  const at=Date.now();
  const result=await db().batch([
   db().prepare("UPDATE payouts SET status='paid',tx_hash=?,updated=?,actor=? WHERE id=? AND status='awaiting'").bind(tx.toLowerCase(),at,me.id,id),
   auditStatement(me.id,'pay-confirm',id,{tx:tx.toLowerCase()},true)
  ]);
  if(!result[0].meta.changes)fail('Выплата уже подтверждена или не найдена',409);
  return json({ok:true});
 }
 if(path==='plan'&&method==='POST'){
  needAdmin();
  const id=field(b.id,80),minutes=Number(b.dailyMinutes);
  if(!Number.isInteger(minutes)||minutes<0||minutes>1440)fail('Норма дня — минуты от 0 до 1440');
  const target=await first('SELECT role FROM people WHERE id=?',id);
  if(!target)fail('Сотрудник не найден',404);
  if(target.role==='owner'&&me.role!=='owner')fail('Норму владельца меняет только владелец',403);
  await db().batch([db().prepare('UPDATE people SET daily_minutes=? WHERE id=?').bind(minutes,id),auditStatement(me.id,'plan',id,{dailyMinutes:minutes})]);
  return json({ok:true});
 }
 if(path==='absence'&&method==='POST'){
  const personId=field(b.personId,80),day=field(b.day,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))fail('Неверная дата');
  if(personId!==me.id)needAdmin();
  if(!await first('SELECT id FROM people WHERE id=?',personId))fail('Сотрудник не найден',404);
  if(b.off!==true&&b.off!==false)fail('Укажите отметку');
  const note=typeof b.note==='string'?b.note.trim().slice(0,200):'';
  await db().batch(b.off?[
    db().prepare('INSERT INTO absences (person_id,day,note,created) VALUES (?,?,?,?) ON CONFLICT(person_id,day) DO UPDATE SET note=excluded.note').bind(personId,day,note,Date.now()),
    auditStatement(me.id,'absence',personId,{day,off:true})
  ]:[
    db().prepare('DELETE FROM absences WHERE person_id=? AND day=?').bind(personId,day),
    auditStatement(me.id,'absence',personId,{day,off:false})
  ]);
  return json({ok:true});
 }
 if(path==='work-link'&&method==='POST'){
  if(b.remove===true){
    const id=field(b.id,80);
    const row=await first('SELECT person_id FROM work_links WHERE id=?',id);
    if(!row)fail('Ссылка не найдена',404);
    if(row.person_id!==me.id)needAdmin();
    await db().batch([db().prepare('DELETE FROM work_links WHERE id=?').bind(id),auditStatement(me.id,'work-link',id,{remove:true})]);
    return json({ok:true});
  }
  const personId=b.personId?field(b.personId,80):me.id,day=field(b.day,10),url=field(b.url,500);
  if(personId!==me.id)needAdmin();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))fail('Неверная дата');
  if(!isWorkUrl(url))fail('Нужна ссылка http или https');
  if(!await first('SELECT id FROM people WHERE id=?',personId))fail('Сотрудник не найден',404);
  const note=typeof b.note==='string'?b.note.trim().slice(0,200):'';
  const id=crypto.randomUUID();
  await db().batch([db().prepare('INSERT INTO work_links (id,person_id,day,url,note,actor,created) VALUES (?,?,?,?,?,?,?)').bind(id,personId,day,url,note,me.id,Date.now()),auditStatement(me.id,'work-link',id,{day,url})]);
  return json({ok:true,id});
 }
 return json({error:'Не найдено'},404);
}
export const GET=apiBoundary(handle);export const POST=GET;export const PUT=GET;export const PATCH=GET;export const DELETE=GET;
