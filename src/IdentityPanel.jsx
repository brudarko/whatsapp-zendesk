import React, { useEffect, useState } from "react";
import { Field, Label, Select } from "@zendeskgarden/react-forms";
import { Notice, Disclosure } from "./GardenUI.jsx";
import { messagingIds, resolveWhatsApp, notificationDestination } from "./identity.js";

const scope = { appId: "aaaaaaaaaaaaaaaaaaaaaaaa", portfolioId: "portfolio-demonstracao", integrationId: "bbbbbbbbbbbbbbbbbbbbbbbb" };
const example = { user: { id: 100, name: "Contato fictício", phone: null }, identities: [
  { type: "messaging", value: "cccccccccccccccccccccccc" },
] };
function simulation(scenario) {
  const client = { id: "dddddddddddddddddddddddd", messagingUserId: example.identities[0].value,
    type: "whatsapp", integrationId: scope.integrationId, status: "active", externalId: "BR.exemplo-sem-telefone" };
  const clients = scenario === "none" ? [] : scenario === "pending" ? [{ ...client, status: "pending" }]
    : scenario === "ambiguous" ? [client, { ...client, id: "eeeeeeeeeeeeeeeeeeeeeeee", externalId: "BR.outro-exemplo" }]
    : scenario === "other" ? [{ ...client, integrationId: "ffffffffffffffffffffffff" }] : [client];
  return resolveWhatsApp(example, clients, scope);
}

export function IdentityPanel({ requesterId, api }) {
  const [scenario, setScenario] = useState("real"), [contact, setContact] = useState(null), [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setContact(null); setError("");
    if (requesterId) api.contact(requesterId).then((c) => { if (alive) setContact(c); })
      .catch(() => { if (alive) setError("Não foi possível consultar as identidades do contato."); });
    return () => { alive = false; };
  }, [requesterId, api]);
  const identity = scenario === "real" ? null : simulation(scenario);
  return <section>
    <h2>Destinatário WhatsApp</h2>
    <p>O contato pode usar WhatsApp sem disponibilizar o telefone. O ID de messaging aponta para o Sunshine; ele não é o BSUID.</p>
    <Field className="app-field">
      <Label>Visualização</Label>
      <Select value={scenario} onChange={(e) => setScenario(e.target.value)}>
        <option value="real">Dados do contato atual</option>
        <option value="bsuid">Simular BSUID sem telefone</option>
        <option value="pending">Simular confirmação pendente</option>
        <option value="ambiguous">Simular destinos divergentes</option>
        <option value="other">Simular outra integração</option>
        <option value="none">Simular contato sem vínculo</option>
      </Select>
    </Field>
    {scenario === "real" ? <>
      {error && <Notice danger>{error}</Notice>}
      {!requesterId && <p>Abra um ticket ou perfil em Customers para consultar o contato. Os exemplos acima funcionam sem WABA.</p>}
      {requesterId && !contact && !error && <p role="status">Consultando identidades…</p>}
      {contact && <div className="card">
        <h3>{contact.user.name || "Contato"}</h3><p>{contact.user.phone || "Telefone não disponibilizado"}</p>
        <p>{messagingIds(contact).length} vínculo(s) messaging no Support</p>
        <ul>{messagingIds(contact).map((id) => <li key={id}><code>{id}</code></li>)}</ul>
        <p>BSUID ainda não consultado. A leitura dos clientes Sunshine exige credenciais de conversas no serviço; a sessão Support não confirma o destinatário WhatsApp.</p>
      </div>}
    </> : <>
      <Notice>Simulação com dados fictícios. Nenhuma mensagem ou alteração será enviada ao Zendesk ou à Meta.</Notice>
      <div className="card"><h3>{identity.name}</h3>
        <p>{identity.phone || "Telefone não disponibilizado"}</p>
        {identity.state === "resolved" ? <><strong>Destinatário resolvido na simulação</strong>
          <p>BSUID: <code>{identity.identifier.value}</code></p>
          <p>Portfólio: {identity.scope.portfolioId}</p>
          <Disclosure title="Destino preparado para a API" level={4} isCompact><pre>{JSON.stringify(notificationDestination(identity, scope), null, 2)}</pre></Disclosure>
        </> : <p role="status">{identity.reason}</p>}
      </div>
    </>}
    <p>O envio pelo perfil exige conexão do serviço e destinatário confirmado. Nome parecido ou variações do nono dígito não liberam o envio.</p>
  </section>;
}
