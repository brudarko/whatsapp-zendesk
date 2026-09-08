import React, { useState } from "react";
import { Button } from "@zendeskgarden/react-buttons";
import { CustomerMessages, LocalConnection } from "./CustomerMessages.jsx";
import { destinationPhone, formatPhoneInput, getCountries, getCountryCallingCode } from "./outbound.js";

const countryNames = new Intl.DisplayNames(["pt-BR"], { type: "region" });
const countries = getCountries().sort((a, b) => a === "BR" ? -1 : b === "BR" ? 1 : countryNames.of(a).localeCompare(countryNames.of(b), "pt-BR"));

export function TopBarMessages({ data, api, busy, run, notice }) {
  const [mode, setMode] = useState("phone"), [query, setQuery] = useState("");
  const [name, setName] = useState(""), [results, setResults] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [country, setCountry] = useState("BR");
  if (customer) return <section>
    <Button disabled={busy} size="small" onClick={() => { setCustomer(null); setResults(null); }}>Escolher outro destinatário</Button>
    <CustomerMessages customer={customer} data={data} api={api} location="top_bar" busy={busy} run={run} notice={notice} />
  </section>;
  return <section>
    <h2>Enviar mensagem ativa</h2>
    <label className="select-label">Encontrar destinatário
      <select disabled={busy} value={mode} onChange={e => { setMode(e.target.value); setResults(null); setQuery(""); }}>
        <option value="phone">Número de WhatsApp</option>
        <option value="name">Nome de um contato existente</option>
      </select>
    </label>
    <form onSubmit={e => { e.preventDefault(); run(async () => setResults(await api.searchCustomers(mode === "phone" ? destinationPhone(query, country) : query, mode))); }}>
      {mode === "phone" && <label className="select-label">País / DDI
        <select value={country} disabled={busy} onChange={e => { setCountry(e.target.value); setQuery(""); setResults(null); }}>
          {countries.map(code => <option key={code} value={code}>{countryNames.of(code)} (+{getCountryCallingCode(code)})</option>)}
        </select>
      </label>}
      <label className="select-label">{mode === "phone" ? country === "BR" ? "Número com DDD" : "Número com código de área" : "Nome do contato"}
        <input type={mode === "phone" ? "tel" : "text"} required maxLength={255} disabled={busy} value={query}
          placeholder={mode === "phone" ? country === "BR" ? "(11) 98765-4321" : "Número de telefone" : "Digite o nome"}
          onChange={e => {
            if (mode === "phone") {
              const input = e.target, raw = input.value, cursor = input.selectionStart;
              const digitsBefore = raw.slice(0, cursor).replace(/\D/g, "").length;
              const formatted = formatPhoneInput(raw, country);
              setCountry(formatted.country); setQuery(formatted.value);
              if (!raw.startsWith("+") && cursor < raw.length) requestAnimationFrame(() => {
                let position = 0, digits = 0;
                while (position < formatted.value.length && digits < digitsBefore) { if (/\d/.test(formatted.value[position])) digits++; position++; }
                input.setSelectionRange(position, position);
              });
            } else setQuery(e.target.value);
            setResults(null);
          }} />
      </label>
      <Button type="submit" disabled={busy || query.trim().length < 2}>Buscar contato</Button>
    </form>
    {results?.length > 0 && <><p>Selecione o contato e confira o número.</p>
      {results.map(user => <div className="card" key={user.id}>
        <strong>{user.name}</strong><p>#{user.id} · {user.phone || "Sem telefone"} · {user.email || "Sem e-mail"}</p>
        <Button disabled={busy || user.role !== "end-user" || user.suspended} onClick={() => run(async () => {
          const fresh = await api.contact(user.id);
          if (fresh.user.role !== "end-user" || fresh.user.suspended) throw new Error("Contato indisponível.");
          setCustomer(fresh.user);
        })}>Selecionar contato</Button>
      </div>)}
    </>}
    {results?.length === 0 && (mode === "phone" ? <div className="card">
      <p>Nenhum contato encontrado para {destinationPhone(query, country)}. O cadastro será criado ao confirmar o envio.</p>
      <label className="select-label">Nome do novo contato<input maxLength={255} disabled={busy} value={name} onChange={e => setName(e.target.value)} /></label>
      <Button disabled={busy || !name.trim()} onClick={() => setCustomer({ name: name.trim(), phone: destinationPhone(query, country) })}>Escolher template</Button>
    </div> : <p>Nenhum contato encontrado. Para cadastrar, busque pelo número de WhatsApp.</p>)}
  </section>;
}
