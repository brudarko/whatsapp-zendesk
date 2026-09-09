export const templateTypes = [
  { id:"standard", name:"Mensagem personalizada", description:"Texto, mídia e botões para avisos e campanhas.", categories:["UTILITY","MARKETING"] },
  { id:"location", name:"Localização", description:"Mostre um endereço no mapa junto da mensagem.", categories:["UTILITY","MARKETING"], advanced:true },
  { id:"flow", name:"Formulário · WhatsApp Flows", description:"Abra um formulário ou agendamento no WhatsApp.", categories:["UTILITY","MARKETING"], advanced:true },
  { id:"coupon", name:"Cupom de desconto", description:"Inclua um código que o cliente pode copiar.", categories:["MARKETING"], advanced:true },
  { id:"offer", name:"Oferta por tempo limitado", description:"Destaque uma oferta com prazo de validade.", categories:["MARKETING"], advanced:true },
  { id:"carousel", name:"Carrossel de mídia", description:"De 2 a 10 cartões com imagens ou vídeos.", categories:["MARKETING"], advanced:true },
  { id:"catalog", name:"Catálogo", description:"Convide o cliente a explorar sua loja no WhatsApp.", categories:["MARKETING"], advanced:true },
  { id:"product", name:"Produto individual", description:"Apresente um produto do catálogo conectado.", categories:["MARKETING"], advanced:true },
  { id:"products", name:"Lista de produtos", description:"Apresente uma seleção de produtos do catálogo.", categories:["MARKETING"], advanced:true },
  { id:"productCarousel", name:"Carrossel de produtos", description:"Mostre produtos do catálogo em cartões.", categories:["MARKETING"], advanced:true },
  { id:"authentication", name:"Código de autenticação", description:"Copiar código, preenchimento com um toque ou automático.", categories:["AUTHENTICATION"], advanced:true },
  { id:"callPermission", name:"Permissão para ligação", description:"Peça autorização para ligar pelo WhatsApp.", categories:["UTILITY","MARKETING"], advanced:true },
  { id:"voiceCall", name:"Ligação pelo WhatsApp", description:"Inclua um botão para ligar para sua empresa.", categories:["UTILITY","MARKETING"], advanced:true },
  { id:"orderDetails", name:"Pedido e pagamento", description:"Cobrança e detalhes de pedido. Exige pagamentos habilitados.", categories:["UTILITY"], external:true },
  { id:"orderStatus", name:"Status do pedido", description:"Atualizações de pedidos. Disponibilidade regional.", categories:["UTILITY"], external:true },
  { id:"checkout", name:"Compra com pagamento", description:"Botão de compra. Exige elegibilidade regional na Meta.", categories:["MARKETING"], external:true },
];
export const variables = (text="") => [...new Set([...text.matchAll(/\{\{([a-z_][a-z_0-9]*|[1-9]\d*)\}\}/g)].map(m=>m[1]))];
export const sampleText = (text="",examples={}) => text.replace(/\{\{([^{}]+)\}\}/g,(match,id)=>examples[id]||match);
export function requiresMeta(input) {
  const type=templateTypes.find(t=>t.id===(input.kind||"standard"));
  return !type || !!type.advanced || !!type.external || input.parameterFormat==="NAMED" ||
    !!(input.header?.format && !["NONE","TEXT"].includes(input.header.format));
}
