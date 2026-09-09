import React, { useState } from "react";
import { Field, Label, Hint, Input, Select } from "@zendeskgarden/react-forms";
import { Button } from "@zendeskgarden/react-buttons";
import { CustomerMessages, LocalConnection } from "./CustomerMessages.jsx";
import { Notice } from "./GardenUI.jsx";
import { destinationPhone, formatPhone, formatPhoneInput, looksLikePhone, getCountries, getCountryCallingCode } from "./outbound.js";

const countryNames = new Intl.DisplayNames(["pt-BR"], { type: "region" });
const countries = getCountries().sort((a, b) => a === "BR" ? -1 : b === "BR" ? 1 : countryNames.of(a).localeCompare(countryNames.of(b), "pt-BR"));

// O envio ativo depende de um telefone: contato sem número não é destinatário possível,
// então não entra na lista em vez de aparecer com o botão desabilitado.
const sendable = user => !!user.phone && user.role === "end-user" && !user.suspended;

export function TopBarMessages({ data, api, busy, run, notice }) {
  const [query, setQuery] = useState(""), [results, setResults] = useState(null);
  const [name, setName] = useState(""), [customer, setCustomer] = useState(null);
  const [country, setCountry] = useState("BR");
  const byPhone = looksLikePhone(query);
  if (customer) return <section>
    <Button disabled={busy} size="small" onClick={() => { setCustomer(null); setResults(null); }}>Escolher outro destinatário</Button>
    <CustomerMessages customer={customer} data={data} api={api} location="top_bar" busy={busy} run={run} notice={notice} />
  </section>;
  return <section>
    <h2>Enviar mensagem ativa</h2>
    <form onSubmit={e => {
      e.preventDefault();
      run(async () => {
        const found = await api.searchCustomers(byPhone ? destinationPhone(query, country) : query, byPhone ? "phone" : "name");
        setResults(found.filter(sendable));
      });
    }}>
      <div className="tb-search">
        {byPhone && <Field className="app-field tb-country"><Label>DDI</Label>
          <Select value={country} disabled={busy} onChange={e => { setCountry(e.target.value); setQuery(""); setResults(null); }}>
            {countries.map(code => <option key={code} value={code}>{countryNames.of(code)} (+{getCountryCallingCode(code)})</option>)}
          </Select>
        </Field>}
        <Field className="app-field tb-query"><Label>Nome ou número do contato</Label>
          <Input required maxLength={255} disabled={busy} value={query}
            placeholder={country === "BR" ? "Bruno, ou (11) 98765-4321" : "Nome, ou número com código de área"}
            onChange={e => {
              const input = e.target, raw = input.value, cursor = input.selectionStart;
              if (looksLikePhone(raw)) {
                const digitsBefore = raw.slice(0, cursor).replace(/\D/g, "").length;
                const formatted = formatPhoneInput(raw, country);
                setCountry(formatted.country); setQuery(formatted.value);
                if (!raw.startsWith("+") && cursor < raw.length) requestAnimationFrame(() => {
                  let position = 0, digits = 0;
                  while (position < formatted.value.length && digits < digitsBefore) { if (/\d/.test(formatted.value[position])) digits++; position++; }
                  input.setSelectionRange(position, position);
                });
              } else setQuery(raw);
              setResults(null);
            }} />
          <Hint>Só aparecem contatos com telefone cadastrado.</Hint>
        </Field>
      </div>
      <Button type="submit" isPrimary disabled={busy || query.trim().length < 2}>Buscar contato</Button>
    </form>
    {results?.length > 0 && <div className="tb-results">
      <p className="cm-muted cm-count">{results.length} {results.length === 1 ? "contato" : "contatos"}</p>
      {results.map(user => <button className="template" key={user.id} disabled={busy} onClick={() => run(async () => {
        const fresh = await api.contact(user.id);
        if (!sendable(fresh.user)) throw new Error("Contato indisponível para envio ativo.");
        setCustomer(fresh.user);
      })}>
        <strong>{user.name}</strong>
        <span>{formatPhone(user.phone)}</span>
      </button>)}
    </div>}
    {results?.length === 0 && (byPhone ? <div className="card">
      <h3>Cadastrar novo contato</h3>
      <p>{formatPhone(destinationPhone(query, country))}</p>
      <Field className="app-field"><Label>Nome do novo contato</Label><Input maxLength={255} disabled={busy} value={name} onChange={e => setName(e.target.value)} /></Field>
      <Button isPrimary disabled={busy || !name.trim()} onClick={() => setCustomer({ name: name.trim(), phone: destinationPhone(query, country) })}>Escolher template</Button>
    </div> : <Notice>Nenhum contato com telefone para esse nome. Busque pelo número de WhatsApp para cadastrar.</Notice>)}
  </section>;
}
