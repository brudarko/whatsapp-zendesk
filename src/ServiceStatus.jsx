import React, { useEffect, useState } from "react";
import { Notice } from "./GardenUI.jsx";

export function ServiceStatus({ api }) {
  const [channel, setChannel] = useState(undefined);
  const [issues, setIssues] = useState([]);
  useEffect(() => {
    let alive = true;
    api.sunshineScope()
      .then(value => { if (alive) setChannel(value ? { integrationId: value.scope.integrationId } : null); })
      .catch(e => { if (alive) setChannel({ error: e.message }); });
    api.sunshineSettingsIssues().then(list => { if (alive) setIssues(list); }).catch(() => {});
    return () => { alive = false; };
  }, [api]);
  return <>
    {channel === undefined ? <p role="status" className="cm-muted">Verificando o canal WhatsApp…</p>
      : channel?.integrationId ? <Notice type="success" title="Canal WhatsApp conectado">
          <p>Integração {channel.integrationId}</p>
        </Notice>
      : channel?.error ? <Notice danger title="Não foi possível ler o canal WhatsApp"><p>{channel.error}</p></Notice>
      : <Notice title="Credencial da Conversations API ausente">
          <p>Preencha App ID, Key ID e Secret nas configurações do app, em Admin Center · Apps e integrações. A chave é criada em APIs · Conversations API.</p>
          {!!issues.length && <ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
        </Notice>}

  </>;
}
