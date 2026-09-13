import React, { useEffect, useState } from "react";
import { Field, Label, Input, Select, Checkbox } from "@zendeskgarden/react-forms";
import { Button } from "@zendeskgarden/react-buttons";
import { XXL } from "@zendeskgarden/react-typography";
import { Notice, LoadingSkeleton } from "./GardenUI.jsx";

export function TemplateAccess({ api, groups, busy, run }) {
  const [entries, setEntries] = useState(null), [error, setError] = useState("");
  const [selected, setSelected] = useState(""), [label, setLabel] = useState("");
  const [groupIds, setGroupIds] = useState([]), [saved, setSaved] = useState(false);
  useEffect(() => {
    let alive = true;
    api.catalogEntries().then(rows => { if (alive) setEntries(rows); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [api]);
  if (error && !entries) return <Notice danger>{error}</Notice>;
  if (!entries) return <LoadingSkeleton />;
  return <section className="template-access">
    <XXL tag="h1" style={{ margin: 0, fontWeight: 700 }}>Templates</XXL>
    <p>Defina o nome exibido no app e os grupos que podem usar cada template.</p>
    <Field className="app-field"><Label>Template</Label><Select value={selected} disabled={busy} onChange={e => {
      const entry = entries.find(row => String(row.id) === e.target.value);
      setSelected(e.target.value); setLabel(entry?.label || ""); setGroupIds((entry?.groupIds || []).map(String)); setSaved(false); setError("");
    }}><option value="">Selecione um template</option>{entries.map(row => <option key={row.id} value={row.id}>{row.template || row.label} {row.language}</option>)}</Select></Field>
    {selected && <>
      <Field className="app-field"><Label>Nome de exibição</Label><Input value={label} maxLength={80} disabled={busy} onChange={e => { setLabel(e.target.value); setSaved(false); }} /></Field>
      <fieldset><legend>Disponível para os grupos</legend>{groups.map(group => <Field key={group.id}><Checkbox disabled={busy} checked={groupIds.includes(String(group.id))} onChange={e => {
        setGroupIds(ids => e.target.checked ? [...ids, String(group.id)] : ids.filter(id => id !== String(group.id))); setSaved(false);
      }}><Label>{group.name}</Label></Checkbox></Field>)}</fieldset>
      <p>Sem grupos selecionados, disponível para toda a equipe.</p>
      {error && <Notice danger>{error}</Notice>}
      {saved && <Notice type="success">Nome e grupos salvos.</Notice>}
      <Button isPrimary disabled={busy || !label.trim()} onClick={() => run(async () => {
        setError(""); setSaved(false);
        try {
          await api.updateCatalogPresentation({ id: selected, label, groupIds });
          setEntries(rows => rows.map(row => String(row.id) === selected ? { ...row, label: label.trim(), groupIds } : row)); setSaved(true);
        } catch (e) { setError(e.message); }
      })}>Salvar</Button>
    </>}
  </section>;
}
