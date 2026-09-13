import React, {useEffect, useState} from 'react';
import { WindowCard } from './AppChrome.jsx';
import {windowFromConversation, windowDuration} from './domain.js';

export function WindowStatus({ticketId, messages, api, now}) {
  const [remote,setRemote] = useState(null);
  useEffect(() => {
    let active = true, running = false;
    setRemote(null);
    const update = async () => {
      if (running) return;
      running = true;
      try { const value = await api.serviceWindow(ticketId); if(active)setRemote(value); }
      catch { if(active)setRemote(null); }
      finally { running = false; }
    };
    update(); const timer = setInterval(update,60000);
    return () => {active=false;clearInterval(timer);};
  },[ticketId,messages,api]);
  const fromSunshine = Number.isFinite(remote?.lastInbound);
  const win = windowFromConversation(fromSunshine ? [{channel:{name:'whatsapp'},author:{role:'end-user'},timestamp:new Date(remote.lastInbound).toISOString()}] : messages,now);
  const date = value => new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
  const open = win.state === 'open';
  return <WindowCard
    open={open}
    title={open ? `Janela aberta · ${windowDuration(win.remaining)} restantes` : win.state === 'closed' ? 'Janela de 24h encerrada' : 'Janela de atendimento não identificada'}
    date={win.expiresAt ? `${open ? 'Encerra' : 'Encerrou'} em ${date(win.expiresAt)}` : null}
    hint={!open ? 'Envie um template aprovado para reabrir a conversa.' : null}
  />;
}
