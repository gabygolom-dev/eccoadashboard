# Símbolo Eccoa

O arquivo fornecido pelo cliente era um print da foto de perfil, com círculo azul-claro e margens. A pedido do cliente, o fundo foi removido por edição com a ferramenta integrada `image_gen` (sem CLI), mantendo o símbolo azul-marinho e verde-água. Não é um arquivo vetorial original da marca; a referência tem resolução limitada.

Arquivo consumido pelo projeto: `public/assets/eccoa.png`, PNG com canal alfa. O build espelha o mesmo arquivo em `assets/eccoa.png` e `dist/assets/eccoa.png`. O login, cabeçalho e menu usam esse símbolo com proporção preservada.

Prompt inicial:

> Use case: background-extraction. Edit target: the supplied Eccoa profile-picture screenshot. Extract ONLY the existing navy and teal logo symbol as a clean transparent PNG for a website header and login. Remove ALL of the pale blue circular avatar background, thin avatar border, white screenshot corners and surrounding material, including the pale blue filling between the logo strokes. Keep the actual existing symbol unchanged: its exact navy outer open arc, teal middle open arc and navy inner stylized curved E/C with its crossing stroke; preserve original proportions, stroke widths, curve geometry and navy/teal colors. This is background removal of an existing client logo, not a redesign. No new text, no new lines, no white fill, no shadows. Genuine alpha transparency everywhere outside the original navy and teal strokes and in the gaps between them. Center the isolated symbol with only a small even transparent safety margin; trim excessive empty space. Crisp anti-aliased edges.

Prompt final de limpeza:

> Use case: background-extraction. Clean this isolated Eccoa symbol. Preserve ALL existing logo shapes, stroke geometry, proportions and placement. Change only the pixel cleanup: remove the stray neon green speckles/rough fringe around the teal stroke and any colored pixels outside the smooth logo silhouette. Use smooth clean antialiased edges and uniform flat navy #173448 and flat muted teal #40b49f, with no gradients, shading, texture or glow. Keep genuine alpha transparency everywhere outside the three logo strokes and between them. No pale blue avatar background, no white background, no circle, no text, no new elements. Tight crop around the symbol with small transparent safety margin. This is cleanup of an existing client logo, no redesign.
