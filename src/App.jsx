import { useState, useEffect, useCallback } from "react";
import { db } from "./firebase";
import { ref, onValue, set } from "firebase/database";

const HOURS       = Array.from({ length: 16 }, (_, i) => i + 8);
const DAYS_SHORT  = ["LUN","MAR","MIÉ","JUE","VIE","SÁB","DOM"];
const BAND_COLORS = ["#FF3D5A","#FF7A00","#FFD600","#00E676","#00B0FF","#D500F9","#FF4081","#00BCD4","#8BC34A","#FF5722"];

function getWeekDates(offset = 0) {
  const now = new Date();
  const dow = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
  monday.setHours(0,0,0,0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

const fmt      = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const slotKey  = (date, hour) => `${fmt(date)}_${hour}`;
const uid      = () => Math.random().toString(36).slice(2,10);
const randColor= () => BAND_COLORS[Math.floor(Math.random() * BAND_COLORS.length)];

function buildSlotMap(reservations) {
  const map = {};
  for (const [id, r] of Object.entries(reservations)) {
    for (const s of r.slots) map[s] = id;
  }
  return map;
}

function rectSlots(weekDates, sel) {
  if (!sel.start || !sel.end) return [];
  const di0 = Math.min(sel.start.di, sel.end.di);
  const di1 = Math.max(sel.start.di, sel.end.di);
  const h0  = Math.min(sel.start.hour, sel.end.hour);
  const h1  = Math.max(sel.start.hour, sel.end.hour);
  const slots = [];
  for (let di = di0; di <= di1; di++)
    for (let h = h0; h <= h1; h++)
      slots.push(slotKey(weekDates[di], h));
  return slots;
}

function SlotsPreview({ slots, color }) {
  const sorted = [...slots].sort();
  const byDay = {};
  for (const s of sorted) {
    const [d, h] = s.split("_");
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(Number(h));
  }
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      {Object.entries(byDay).map(([d, hrs]) => {
        hrs.sort((a,b) => a-b);
        const ranges = [];
        let start = hrs[0], end = hrs[0];
        for (let i = 1; i < hrs.length; i++) {
          if (hrs[i] === end + 1) { end = hrs[i]; }
          else { ranges.push([start, end]); start = end = hrs[i]; }
        }
        ranges.push([start, end]);
        return (
          <div key={d} style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:3, minHeight:18, background:color, borderRadius:2 }}/>
            <div style={{ fontSize:11, color:"#aab", letterSpacing:1 }}>
              <span style={{ color, fontWeight:900 }}>{d}</span>
              {" · "}
              {ranges.map(([s,e],i) => (
                <span key={i}>{s}:00–{e+1}:00{i < ranges.length-1 ? " + " : ""}</span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Overlay({ children, onClose }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"#000000dd",
      display:"flex", alignItems:"center", justifyContent:"center", zIndex:500, padding:16 }}
      onClick={onClose}>
      <div style={{ background:"#0c1018", border:"1px solid #1a2a2a", borderRadius:14,
        padding:24, width:"100%", maxWidth:380 }}
        onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export default function SalaEnsayo() {
  const [weekOffset, setWeekOffset]     = useState(0);
  const [reservations, setReservations] = useState({});
  const [slotMap, setSlotMap]           = useState({});
  const [sel, setSel]                   = useState({ start:null, end:null, active:false });
  const [modal, setModal]               = useState(null);
  const [viewId, setViewId]             = useState(null);
  const [form, setForm]                 = useState({ name:"", band:"", color: randColor() });
  const [toast, setToast]               = useState("");
  const [loading, setLoading]           = useState(true);
  const [syncing, setSyncing]           = useState(false);
  const [pendingSlots, setPendingSlots] = useState([]);

  const weekDates = getWeekDates(weekOffset);
  const today = fmt(new Date());

  useEffect(() => {
    const reservationsRef = ref(db, "reservations");
    const unsubscribe = onValue(reservationsRef, (snapshot) => {
      const data = snapshot.val() || {};
      setReservations(data);
      setSlotMap(buildSlotMap(data));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  async function persist(data) {
    setSyncing(true);
    try {
      await set(ref(db, "reservations"), data);
    } catch (err) {
      console.error("Error guardando:", err);
      showToast("❌ Error al guardar, revisá la conexión");
    }
    setSyncing(false);
  }

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(""), 2800); }

  const onCellDown = useCallback((di, hour) => {
    const key = slotKey(weekDates[di], hour);
    if (slotMap[key]) {
      setViewId(slotMap[key]);
      setModal("view");
      return;
    }
    setSel({ start:{ di, hour }, end:{ di, hour }, active:true });
  }, [slotMap, weekDates]);

  const onCellEnter = useCallback((di, hour) => {
    setSel(s => s.active ? { ...s, end:{ di, hour } } : s);
  }, []);

  const onMouseUp = useCallback(() => {
    setSel(s => {
      if (!s.active || !s.start) return { start:null, end:null, active:false };
      const slots = rectSlots(weekDates, s);
      const blocked = slots.some(sk => slotMap[sk]);
      if (blocked) {
        showToast("⚠️ Algún turno seleccionado ya está reservado");
        return { start:null, end:null, active:false };
      }
      if (slots.length > 0) {
        setForm({ name:"", band:"", color: randColor() });
        setPendingSlots(slots);
        setModal("new");
      }
      return { ...s, active:false };
    });
  }, [slotMap, weekDates]);

  async function handleReserve() {
    if (!form.name.trim()) return;
    const slots = pendingSlots;
    if (!slots.length) return;
    const id = uid();
    const updated = {
      ...reservations,
      [id]: { id, name: form.name.trim(), band: form.band.trim(), color: form.color, slots, createdAt: Date.now() }
    };
    await persist(updated);
    setModal(null);
    setSel({ start:null, end:null, active:false });
    setPendingSlots([]);
    showToast("✅ Reserva guardada para todos");
  }

  async function handleDelete(id) {
    const updated = { ...reservations };
    delete updated[id];
    await persist(updated);
    setModal(null);
    setViewId(null);
    showToast("🗑️ Reserva eliminada");
  }

  function shareWhatsApp(r) {
    const url = window.location.href;
    const sorted = [...r.slots].sort();
    const byDay = {};
    for (const s of sorted) { const [d,h] = s.split("_"); if(!byDay[d]) byDay[d]=[]; byDay[d].push(Number(h)); }
    const lines = Object.entries(byDay).map(([d, hrs]) => {
      hrs.sort((a,b)=>a-b);
      return `  📅 ${d}: ${hrs[0]}:00 – ${hrs[hrs.length-1]+1}:00`;
    }).join("\n");
    const text = `🎸 *Reserva – Sala de Ensayo*\n👤 ${r.name}${r.band?`\n🎵 Banda: ${r.band}`:""}\n\n${lines}\n\n📲 Ver agenda: ${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  const selSlots = new Set(pendingSlots.length ? pendingSlots : rectSlots(weekDates, sel));
  const viewRes  = viewId ? reservations[viewId] : null;

  if (loading) return (
    <div style={{ background:"#080b10", minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ color:"#00E676", fontFamily:"monospace", fontSize:18, letterSpacing:6 }}>CARGANDO...</div>
    </div>
  );

  return (
    <div style={{ background:"#080b10", minHeight:"100vh", fontFamily:"'Courier New',monospace", color:"#dde", userSelect:"none" }}
      onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>

      <div style={{ background:"#0c1018", borderBottom:"2px solid #00E676", padding:"18px 16px 14px", position:"sticky", top:0, zIndex:200 }}>
        <div style={{ maxWidth:960, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:24 }}>🎸</span>
              <h1 style={{ margin:0, fontSize:"clamp(15px,3.5vw,22px)", fontWeight:900, letterSpacing:4, color:"#fff", textTransform:"uppercase" }}>
                SALA DE ENSAYO
              </h1>
              {syncing && <span style={{ fontSize:9, color:"#00E676", letterSpacing:2 }}>GUARDANDO…</span>}
            </div>
            <div style={{ fontSize:9, color:"#00E676", letterSpacing:2, marginTop:2 }}>AGENDA COMPARTIDA · TIEMPO REAL</div>
          </div>
          <div style={{ fontSize:10, color:"#334", letterSpacing:1, lineHeight:2 }}>
            <span style={{ color:"#1a2a1a" }}>■</span> Libre &nbsp;
            <span style={{ color:"#FF3D5A" }}>■</span> Reservado &nbsp;
            <span style={{ color:"#00B0FF" }}>■</span> Selección
          </div>
        </div>
      </div>

      <div style={{ maxWidth:960, margin:"14px auto 0", padding:"0 12px" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
          background:"#0c1018", border:"1px solid #1a2a1a", borderRadius:10, padding:"10px 14px" }}>
          <button onClick={() => setWeekOffset(w => Math.max(0, w - 1))} style={navBtnS}>‹ ANT</button>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:12, fontWeight:900, color:"#00E676", letterSpacing:2 }}>
              {weekOffset===0?"SEMANA ACTUAL":weekOffset===1?"PRÓXIMA SEMANA":`SEMANA +${weekOffset}`}
            </div>
            <div style={{ fontSize:10, color:"#334", marginTop:2 }}>{fmt(weekDates[0])} → {fmt(weekDates[6])}</div>
          </div>
          <button onClick={() => setWeekOffset(w => w+1)} style={navBtnS}>SIG ›</button>
        </div>
        <div style={{ fontSize:10, color:"#334", textAlign:"center", marginTop:8, letterSpacing:1 }}>
          ARRASTRÁ para seleccionar múltiples horas/días · Tocá una reserva para ver detalles
        </div>
      </div>

      <div style={{ maxWidth:960, margin:"12px auto 0", padding:"0 12px", overflowX:"auto" }}>
        <div style={{ minWidth:540 }}>
          <div style={{ display:"grid", gridTemplateColumns:"48px repeat(7,1fr)", gap:2, marginBottom:2 }}>
            <div/>
            {weekDates.map((d,i) => {
              const isToday = fmt(d) === today;
              return (
                <div key={i} style={{ textAlign:"center", padding:"7px 2px",
                  background: isToday?"#00E67618":"#0c1018",
                  border:`1px solid ${isToday?"#00E676":"#1a2a1a"}`, borderRadius:6 }}>
                  <div style={{ fontSize:9, color:isToday?"#00E676":"#334", letterSpacing:1, fontWeight:900 }}>{DAYS_SHORT[i]}</div>
                  <div style={{ fontSize:16, fontWeight:900, color:isToday?"#00E676":"#99a" }}>{d.getDate()}</div>
                  <div style={{ fontSize:9, color:"#223" }}>{d.getMonth()+1}/{String(d.getFullYear()).slice(2)}</div>
                </div>
              );
            })}
          </div>

          {HOURS.map(hour => (
            <div key={hour} style={{ display:"grid", gridTemplateColumns:"48px repeat(7,1fr)", gap:2, marginBottom:2 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end",
                paddingRight:6, color:"#223", fontSize:10, fontWeight:700 }}>{hour}h</div>
              {weekDates.map((_, di) => {
                const key    = slotKey(weekDates[di], hour);
                const resId  = slotMap[key];
                const res    = resId ? reservations[resId] : null;
                const inSel  = selSlots.has(key);
                const isPast = weekDates[di] < new Date(new Date().setHours(hour,0,0,0));

                const prevHourKey = slotKey(weekDates[di], hour-1);
                const nextHourKey = slotKey(weekDates[di], hour+1);
                const prevDayKey  = di > 0 ? slotKey(weekDates[di-1], hour) : null;
                const nextDayKey  = di < 6 ? slotKey(weekDates[di+1], hour) : null;
                const topConn     = res && res.slots.includes(prevHourKey);
                const bottomConn  = res && res.slots.includes(nextHourKey);
                const leftConn    = res && prevDayKey && res.slots.includes(prevDayKey);
                const rightConn   = res && nextDayKey && res.slots.includes(nextDayKey);
                const isLabel     = res && !topConn && !leftConn;

                let bg = isPast && !res ? "#090c0f" : "#0c1018";
                let border = "1px solid #1a2a1a";
                let cursor = isPast && !res ? "default" : "crosshair";
                if (inSel && !resId) { bg="#00B0FF18"; border="1px solid #00B0FF66"; }
                if (res) { bg=`${res.color}22`; border=`1px solid ${res.color}44`; cursor="pointer"; }

                const tl = (!topConn && !leftConn)    ? 5 : 0;
                const tr = (!topConn && !rightConn)   ? 5 : 0;
                const bl = (!bottomConn && !leftConn) ? 5 : 0;
                const br = (!bottomConn && !rightConn)? 5 : 0;

                return (
                  <div key={di}
                    style={{ height:40, background:bg, border, cursor, position:"relative", overflow:"hidden",
                      borderRadius:`${tl}px ${tr}px ${br}px ${bl}px`, transition:"background .08s",
                      display:"flex", alignItems:"center", justifyContent:"center" }}
                    onMouseDown={() => onCellDown(di, hour)}
                    onMouseEnter={() => onCellEnter(di, hour)}
                  >
                    {isLabel && res && (
                      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
                        alignItems:"center", justifyContent:"center", padding:"2px 4px" }}>
                        <div style={{ fontSize:9, fontWeight:900, color:res.color, textAlign:"center",
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", width:"100%" }}>
                          {res.band || res.name}
                        </div>
                        {res.band && (
                          <div style={{ fontSize:8, color:"#99a", overflow:"hidden", textOverflow:"ellipsis",
                            whiteSpace:"nowrap", width:"100%", textAlign:"center" }}>{res.name}</div>
                        )}
                      </div>
                    )}
                    {!res && !isPast && !inSel && <div style={{ fontSize:13, color:"#1a2a1a" }}>·</div>}
                    {inSel && !res && <div style={{ fontSize:10, color:"#00B0FF", fontWeight:900 }}>✓</div>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {modal === "new" && (
        <Overlay onClose={() => { setModal(null); setSel({ start:null, end:null, active:false }); setPendingSlots([]); }}>
          <div style={{ borderBottom:"1px solid #1a2a1a", paddingBottom:14, marginBottom:16 }}>
            <div style={{ fontSize:10, color:"#00E676", letterSpacing:2, marginBottom:8 }}>NUEVA RESERVA</div>
            <SlotsPreview slots={pendingSlots} color="#00E676"/>
          </div>
          <label style={lbl}>NOMBRE *</label>
          <input style={inp} placeholder="Tu nombre" autoFocus value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            onKeyDown={e => e.key==="Enter" && handleReserve()}/>
          <label style={lbl}>BANDA (opcional)</label>
          <input style={inp} placeholder="Nombre de la banda" value={form.band}
            onChange={e => setForm(f => ({ ...f, band: e.target.value }))}
            onKeyDown={e => e.key==="Enter" && handleReserve()}/>
          <label style={lbl}>COLOR</label>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:20 }}>
            {BAND_COLORS.map(c => (
              <div key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                style={{ width:26, height:26, borderRadius:"50%", background:c, cursor:"pointer",
                  border: form.color===c ? "3px solid #fff" : "3px solid transparent", transition:"border .15s" }}/>
            ))}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => { setModal(null); setSel({ start:null, end:null, active:false }); setPendingSlots([]); }}
              style={{ ...btnSec, flex:1 }}>CANCELAR</button>
            <button onClick={handleReserve} disabled={!form.name.trim()}
              style={{ ...btnPri, flex:1, background:"#00E676", color:"#000", opacity: form.name.trim()?1:.4 }}>
              RESERVAR
            </button>
          </div>
        </Overlay>
      )}

      {modal === "view" && viewRes && (
        <Overlay onClose={() => { setModal(null); setViewId(null); }}>
          <div style={{ borderLeft:`4px solid ${viewRes.color}`, paddingLeft:14, marginBottom:16 }}>
            <div style={{ fontSize:10, color:viewRes.color, letterSpacing:2, marginBottom:4 }}>RESERVA ACTIVA</div>
            <div style={{ fontSize:20, fontWeight:900, color:"#fff" }}>{viewRes.band || viewRes.name}</div>
            {viewRes.band && <div style={{ fontSize:13, color:"#aab" }}>👤 {viewRes.name}</div>}
          </div>
          <SlotsPreview slots={viewRes.slots} color={viewRes.color}/>
          <div style={{ height:16 }}/>
          <button onClick={() => shareWhatsApp(viewRes)}
            style={{ ...btnWA, width:"100%", marginBottom:10 }}>
            📲 COMPARTIR EN WHATSAPP
          </button>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => { setModal(null); setViewId(null); }} style={{ ...btnSec, flex:1 }}>CERRAR</button>
            <button onClick={() => handleDelete(viewRes.id)} style={{ ...btnDng, flex:1 }}>ELIMINAR</button>
          </div>
        </Overlay>
      )}

      {toast && (
        <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)",
          background:"#0c1018", border:"1px solid #00E676", borderRadius:8,
          padding:"11px 22px", color:"#fff", fontSize:12, fontWeight:700, letterSpacing:1,
          zIndex:999, whiteSpace:"nowrap", animation:"slideUp .2s ease" }}>
          {toast}
        </div>
      )}

      <style>{`
        * { box-sizing: border-box; }
        @keyframes slideUp { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        ::-webkit-scrollbar { width:5px; height:5px; }
        ::-webkit-scrollbar-track { background:#080b10; }
        ::-webkit-scrollbar-thumb { background:#1a2a1a; border-radius:3px; }
        input::placeholder { color:#223; }
        input:focus { outline:none; border-color:#00E67688 !important; }
      `}</style>
    </div>
  );
}

const navBtnS = { background:"none", border:"1px solid #1a2a1a", color:"#334", padding:"6px 12px", borderRadius:6, cursor:"pointer", fontSize:10, fontFamily:"'Courier New',monospace", fontWeight:900, letterSpacing:1 };
const lbl     = { display:"block", fontSize:10, color:"#00E676", letterSpacing:2, marginBottom:6, fontWeight:700 };
const inp     = { width:"100%", background:"#080b10", border:"1px solid #1a2a1a", borderRadius:7, padding:"10px 12px", color:"#dde", fontSize:13, fontFamily:"'Courier New',monospace", marginBottom:14 };
const btnPri  = { border:"none", padding:"11px 0", borderRadius:7, cursor:"pointer", fontSize:11, fontFamily:"'Courier New',monospace", fontWeight:900, letterSpacing:2 };
const btnSec  = { ...btnPri, background:"none", border:"1px solid #1a2a1a", color:"#445" };
const btnDng  = { ...btnPri, background:"#1a0a0c", border:"1px solid #FF3D5A55", color:"#FF3D5A" };
const btnWA   = { ...btnPri, background:"#0d2a22", border:"1px solid #128C7E", color:"#25D366" };