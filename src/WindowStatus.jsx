import React, {useEffect, useState} from 'react';
import { Notice, Disclosure } from './GardenUI.jsx';
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
  return <div className="window-details"><Notice type={win.state === "open" ? "success" : "info"}>
    <strong>{win.state === 'open' ? `Janela aberta · ${windowDuration(win.remaining)} restantes` : win.state === 'closed' ? 'Janela de 24h encerrada' : 'Janela de atendimento não identificada'}</strong>
    {win.expiresAt && <p>{win.state === 'open' ? 'Encerra' : 'Encerrou'} em {date(win.expiresAt)}</p>}
    {win.state !== 'open' && <p>Use um template aprovado para iniciar a conversa.</p>}
    <Disclosure title="Detalhes do prazo" level={4} isCompact isBare>
      {win.lastInbound && <p>Última mensagem do cliente: {date(win.lastInbound)}.</p>}
      <p>Cada mensagem do cliente abre ou renova a janela por 24 horas, inclusive respostas a mensagens ativas. Enviar uma mensagem não renova o prazo.</p>
      {!fromSunshine && <p>Estimativa pelo ticket. Não foi possível confirmar a última mensagem pelo Sunshine.</p>}
    </Disclosure>
  </Notice></div>;
}
