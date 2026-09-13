import React from 'react';
import { createGlobalStyle } from 'styled-components';
import { getColor } from '@zendeskgarden/react-theming';
import { Alert, Title } from '@zendeskgarden/react-notifications';
import { Skeleton } from '@zendeskgarden/react-loaders';
import { Accordion } from '@zendeskgarden/react-accordions';

// Layout CSS shares Garden's semantic tokens; components retain their own styles.
export const AppStyles = createGlobalStyle`
  :root {
    --foreground: ${({theme}) => getColor({theme, variable:'foreground.default'})};
    --muted: ${({theme}) => getColor({theme, variable:'foreground.subtle'})};
    --primary: ${({theme}) => getColor({theme, variable:'foreground.primary'})};
    --border: ${({theme}) => getColor({theme, variable:'border.default'})};
    --subtle-border: ${({theme}) => getColor({theme, variable:'border.subtle'})};
    --surface: ${({theme}) => getColor({theme, variable:'background.default'})};
    --subtle: ${({theme}) => getColor({theme, variable:'background.subtle'})};
    --success: ${({theme}) => getColor({theme, variable:'foreground.success'})};
    --success-bg: ${({theme}) => getColor({theme, variable:'background.success'})};
    --success-border: ${({theme}) => getColor({theme, variable:'border.success'})};
    --danger: ${({theme}) => getColor({theme, variable:'foreground.danger'})};
    --danger-bg: ${({theme}) => getColor({theme, variable:'background.danger'})};
    --danger-border: ${({theme}) => getColor({theme, variable:'border.danger'})};
    --warning: ${({theme}) => getColor({theme, variable:'foreground.warning'})};
    --warning-bg: ${({theme}) => getColor({theme, variable:'background.warning'})};
    --warning-border: ${({theme}) => getColor({theme, variable:'border.warning'})};
  }
  html { color-scheme: ${({theme}) => theme.colors.base}; height: 100%; }
  body, #root { min-height: 100%; }
  body { font-family: ${({theme}) => theme.fonts.system}; font-size: ${({theme}) => theme.fontSizes.md}; }
`;

// Single-section Garden accordion replacing native details/summary: same disclosure,
// with Garden's chevron, focus ring and heading rank. level sets aria-level.
export function Disclosure({title, children, level=3, isCompact=false, isBare=false, className}) {
  return <Accordion level={level} isCompact={isCompact} isBare={isBare} isCollapsible isExpandable
    defaultExpandedSections={[]} className={className}>
    <Accordion.Section>
      <Accordion.Header><Accordion.Label>{title}</Accordion.Label></Accordion.Header>
      <Accordion.Panel>{children}</Accordion.Panel>
    </Accordion.Section>
  </Accordion>;
}

export function Notice({children, danger=false, type, title}) {
  return <Alert type={type || (danger ? 'error' : 'info')} role={danger ? 'alert' : 'status'} className="app-notice">
    {title && <Title>{title}</Title>}
    <Alert.Paragraph as="div">{children}</Alert.Paragraph>
  </Alert>;
}

export function LoadingSkeleton({ label = "Carregando dados…", compact = false }) {
  return <div role="status" aria-label={label} aria-busy="true" className={`loading-skeleton${compact ? " loading-skeleton-compact" : ""}`}>
    <div aria-hidden="true"><Skeleton style={{ width: compact ? '60%' : '45%', height: compact ? 12 : 16 }} /><Skeleton style={{ height: compact ? 24 : 40, marginTop: compact ? 10 : 16 }} /><Skeleton style={{ height: compact ? 40 : 72, marginTop: compact ? 10 : 16 }} /></div>
  </div>;
}
