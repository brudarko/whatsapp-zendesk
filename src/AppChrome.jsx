import React from "react";
import styled, { useTheme } from "styled-components";
import { getColor } from "@zendeskgarden/react-theming";
import { Button, IconButton } from "@zendeskgarden/react-buttons";
import { Tag } from "@zendeskgarden/react-tags";
import { LG, SM } from "@zendeskgarden/react-typography";

function Svg({ children, size = 16 }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 16 16" focusable="false" aria-hidden="true">{children}</svg>;
}

export function SpeechBubbleLightningIcon({ size } = {}) {
  return <Svg size={size}>
    <path fill="none" stroke="currentColor" d="M1 .5h14c.28 0 .5.22.5.5v10c0 .28-.22.5-.5.5H8l-3.65 3.65a.5.5 0 01-.85-.35v-3.3H1c-.28 0-.5-.22-.5-.5V1C.5.72.72.5 1 .5z"/>
    <path fill="currentColor" d="M10.03 6H8.52l1.96-3.72c.06-.15-.01-.28-.17-.28H7.39c-.16 0-.34.13-.4.28l-1.46 3.4c-.07.16 0 .32.16.32H7l-1.42 4.07c-.11.29-.03.54.34.21l4.13-3.89c.23-.23.22-.39-.02-.39z"/>
  </Svg>;
}
export function PlusIcon() {
  return <Svg><path stroke="currentColor" strokeLinecap="round" d="M7.5 2.5v12m6-6h-12"/></Svg>;
}
export function UserGroupIcon() {
  return <Svg><g fill="none" stroke="currentColor">
    <circle cx="11" cy="6" r="2.5"/><circle cx="4.5" cy="3.5" r="2"/>
    <path strokeLinecap="round" d="M15.5 14.5c-.2-2.2-2.2-4-4.5-4s-4.3 1.8-4.5 4m1-5c-.4-1.2-1.7-2-3-2s-2.6.8-3 2"/>
  </g></Svg>;
}
export function ReloadIcon() {
  return <Svg><path fill="none" stroke="currentColor" strokeLinecap="round" d="M13.1 12c-1.2 1.5-3 2.5-5.1 2.5-3.6 0-6.5-2.9-6.5-6.5S4.4 1.5 8 1.5c2.2 0 4.1 1.1 5.3 2.7m.2-3.7V4c0 .3-.2.5-.5.5H9.5"/></Svg>;
}
export function XIcon() {
  return <Svg><path stroke="currentColor" strokeLinecap="round" d="M3 13L13 3m0 10L3 3"/></Svg>;
}
export function CheckCircleIcon({ size } = {}) {
  return <Svg size={size}><g fill="none" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 9l2.5 2.5 5-5"/><circle cx="7.5" cy="8.5" r="7"/>
  </g></Svg>;
}
export function XCircleIcon() {
  return <Svg><g fill="none" stroke="currentColor">
    <circle cx="7.5" cy="8.5" r="7"/><path strokeLinecap="round" d="M4.5 11.5l6-6m0 6l-6-6"/>
  </g></Svg>;
}
export function AlertWarningIcon({ size } = {}) {
  return <Svg size={size}>
    <path fill="none" stroke="currentColor" strokeLinecap="round" d="M.88 13.77L7.06 1.86c.19-.36.7-.36.89 0l6.18 11.91c.17.33-.07.73-.44.73H1.32c-.37 0-.61-.4-.44-.73zM7.5 6v3.5"/>
    <circle cx="7.5" cy="12" r="1" fill="currentColor"/>
  </Svg>;
}
export function InfoIcon() {
  return <Svg>
    <g fill="none" stroke="currentColor"><circle cx="7.5" cy="8.5" r="7"/><path strokeLinecap="round" d="M7.5 11.5v-4"/></g>
    <circle cx="7.5" cy="5" r="1" fill="currentColor"/>
  </Svg>;
}

const IconMark = styled.div`
  width: ${p => p.$size}px;
  height: ${p => p.$size}px;
  border-radius: 8px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${p => getColor({ theme: p.theme, hue: "neutralHue", shade: 800 })};
  color: #fff;
`;

export function AppIcon({ size = 28 }) {
  return <IconMark $size={size}><SpeechBubbleLightningIcon /></IconMark>;
}

const HeaderBar = styled.header`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid ${p => getColor({ theme: p.theme, variable: "border.subtle" })};
  background: ${p => getColor({ theme: p.theme, variable: "background.default" })};
  flex-shrink: 0;
`;

export function AppHeader({ title = "WhatsApp", onNew, onBulk, onRefresh, onClose }) {
  return <HeaderBar>
    <AppIcon size={28} />
    <LG style={{ fontWeight: 700, flex: 1, margin: 0 }}>{title}</LG>
    {onNew && <IconButton size="small" isPrimary aria-label="Nova mensagem ativa" onClick={onNew}><PlusIcon /></IconButton>}
    {onBulk && <IconButton size="small" aria-label="Enviar em massa" onClick={onBulk}><UserGroupIcon /></IconButton>}
    {onRefresh && <IconButton size="small" aria-label="Atualizar" onClick={onRefresh}><ReloadIcon /></IconButton>}
    {onClose && <IconButton aria-label="Fechar" onClick={onClose}><XIcon /></IconButton>}
  </HeaderBar>;
}

const WindowBox = styled.div`
  border: 1px solid ${p => getColor({ theme: p.theme, variable: p.$open ? "border.success" : "border.default" })};
  background: ${p => getColor({ theme: p.theme, variable: p.$open ? "background.success" : "background.subtle" })};
  border-radius: 8px;
  padding: 14px;
  color: ${p => getColor({ theme: p.theme, variable: p.$open ? "foreground.success" : "foreground.default" })};
`;

const WindowMeta = styled(SM)`
  display: block;
  margin-top: 2px;
  color: ${p => getColor({ theme: p.theme, variable: p.$open ? "foreground.success" : "foreground.subtle" })};
`;

export function WindowCard({ open, title, date, hint }) {
  return <WindowBox $open={open} className="window-card">
    <div className="window-card-row">
      <span className="window-card-icon" aria-hidden="true">{open ? <CheckCircleIcon /> : <InfoIcon />}</span>
      <div>
        <strong>{title}</strong>
        {date && <WindowMeta $open={open}>{date}</WindowMeta>}
        {hint && <WindowMeta $open={open}>{hint}</WindowMeta>}
      </div>
    </div>
  </WindowBox>;
}

const PreviewBox = styled.div`
  background: ${p => getColor({ theme: p.theme, variable: "background.subtle" })};
  border: 1px solid ${p => getColor({ theme: p.theme, variable: "border.subtle" })};
  border-radius: 8px;
  padding: 12px;
  margin: 16px 0;
`;

export function MessagePreview({ title = "Prévia da mensagem", children }) {
  return <PreviewBox className="cm-preview">
    <SM style={{ fontWeight: 700, display: "block", marginBottom: 6 }}>{title}</SM>
    <div className="cm-preview-body">{children}</div>
  </PreviewBox>;
}

export function statusHue(label) {
  if (/falhou|rejeitad/i.test(label)) return "red";
  if (/lida|respondeu|entregue/i.test(label)) return "green";
  if (/aceita|enviada|aprovad/i.test(label)) return "blue";
  if (/análise|pendente/i.test(label)) return "yellow";
  return "grey";
}

export function StatusTag({ label, hue }) {
  return <Tag hue={hue || statusHue(label)} size="small" isRegular>{label}</Tag>;
}

export function SectionLabel({ children }) {
  const theme = useTheme();
  return <span className="section-label" style={{
    fontWeight: 700, fontSize: 12, letterSpacing: ".04em", textTransform: "uppercase",
    color: getColor({ theme, variable: "foreground.subtle" }),
  }}>{children}</span>;
}

export function openBulkSend(client) {
  if (!client) return Promise.reject(new Error("Zendesk indisponível."));
  return client.invoke("routeTo", "nav_bar");
}
