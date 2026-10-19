# Guia do utilizador do MeteoRide

A ajuda que levas dentro da app responde a "o que é que eu faço". Este guia
responde a "porquê" e "o que acontece se". O pormenor completo está aqui: os
limites de cada fornecedor, o que a app guarda e onde, como se comporta sem rede
e como obter as apps ou executar a tua própria cópia.

Versión en español: [GUIA.md](GUIA.md) · English version: [GUIDE.md](GUIDE.md) ·
Ajuda da app: [help_pt.html](https://app.meteoride.cc/help_pt.html)

---

## 1. O que é o MeteoRide

O MeteoRide é uma aplicação para ciclistas —na web e como app para iPhone e
Android— que carrega percursos GPX/KML e mostra a previsão do tempo ao longo do
percurso.

A app calcula os passos do percurso a partir da velocidade de pedalada que
escolheres e pede a um ou mais fornecedores meteorológicos a temperatura, o
vento, a precipitação, a humidade, a nebulosidade, a luminosidade e o índice UV
em cada um desses passos. Inclui alternativas automáticas para teres dados
mesmo quando um fornecedor falha, e consegue comparar previsões de fontes
diferentes ou para duas datas diferentes.

O MeteoRide não edita o percurso: só o lê.

---

## 2. Primeiros passos

### 2.1 Carregar um percurso GPX/KML

Carrega no botão **📁** e escolhe o teu ficheiro. São suportados trajetos, rotas
e pontos de passagem GPX e KML normais.

Também podes carregar um percurso a partir de uma ligação com os parâmetros
descritos em [§9.4](#94-urls-com-parâmetros), ou partilhá-lo a partir de outra
app se usares a app nativa ([§6](#6-na-app-para-iphone-e-android)).

### 2.2 Data e hora

Escolhe quando pensas sair. O sistema ajusta a hora sozinho a intervalos de 15
minutos.

### 2.3 Velocidade

Introduz a tua velocidade média estimada ou usa uma das predefinidas: 5, 10, 12,
15 ou 20 km/h. A hora a que vais estar em cada ponto sai desta velocidade, por
isso é o que mais muda o resultado.

### 2.4 Intervalo

Escolhe de quanto em quanto tempo queres informação meteorológica: a cada 15 ou
30 minutos.

### 2.5 Fornecedor

Escolhe o fornecedor ou a cadeia de fornecedores que queres usar. Estão
descritos em [§4](#4-fornecedores-meteorológicos). O que acontece quando o que
escolheste falha está em [§9.3](#93-alternativas-inteligentes).

### 2.6 Modo comparar fornecedores

Escolhe **Comparar** na lista de fornecedores para avaliar as diferenças entre
fornecedores no mesmo percurso e à mesma hora.

- Lê o Open-Meteo e o AROME exatamente como a tabela normal, incluindo os dados
  de quarto em quarto de hora nas primeiras 5 horas.
- Se um fornecedor não responder, o aviso indica qual falhou em vez de mostrar
  um erro genérico.

### 2.7 Modo comparar datas

Compara a previsão para o mesmo percurso em duas datas ou horas diferentes.

- Carrega em **⇄** ao lado da data para entrares neste modo.
- Define a Data A e a Data B; a segunda data aparece por baixo da primeira.
- Carrega em **⟲** para atualizar a tabela.
- A tabela mostra 4 linhas: intervalos da Data A, resumo da Data A, intervalos
  da Data B, resumo da Data B.
- **Não há recálculo automático.** Se mudares algum controlo, tens de carregar
  outra vez em ⟲.

---

## 3. Carregar percursos de outros sites (userscripts)

O projeto inclui dois userscripts opcionais para o Tampermonkey. Não são
precisos para usar o MeteoRide; são atalhos para quem planeia noutros sites. As
instruções de instalação estão em [USERSCRIPTS.md](USERSCRIPTS.md).

- **Komoot / Bikemap / Hammerhead → MeteoRide**: acrescenta um botão que abre o
  percurso que estás a ver diretamente no MeteoRide. No Komoot, a descarga do
  GPX só está disponível com uma conta **Premium**; sem ela o script não
  consegue obter o ficheiro.
- **MeteoRide → Hammerhead**: acrescenta um botão no MeteoRide que exporta o GPX
  atual para o Hammerhead (dashboard.hammerhead.io). O script carrega o GPX tal
  como está para um share-server configurado por ti e pede ao Hammerhead que
  importe esse URL.

---

## 4. Fornecedores meteorológicos

| Fornecedor | Chave de API | Horizonte | Cobertura |
|---|---|---|---|
| Open-Meteo | Não | 14 dias | Global |
| OpenWeather | Sim (nível gratuito) | 4 dias | Global |
| AROME-HD | Não | 36 horas | Parte da Europa |

- **Open-Meteo**: gratuito, sem chave, cobertura global, até 14 dias. O
  Open-Meteo escolhe o seu melhor modelo para a zona do teu trajeto.
  Recomendado para qualquer situação, e ideal para planear a longo prazo e para
  percursos fora da Europa.
- **OpenWeather**: precisa de uma chave de API, até 4 dias. Dados em tempo real
  excelentes, e é **o único fornecedor que publica avisos meteorológicos
  oficiais** ([§11](#11-avisos-meteorológicos-oficiais)). O melhor para saídas
  imediatas e zonas urbanas.
- **AROME-HD**: modelo de alta resolução (~1-2 km) da MeteoFrance, acedido
  através do Open-Meteo e sem chave. Só está disponível para a Europa
  (aprox. 39-52°N, 10,5°W-16,5°E) e dentro de 36 horas. Fora dessa zona ou
  dessa janela passa diretamente para o melhor modelo que o Open-Meteo tem para
  esse local, sem nada de estranho a assinalar: continua a haver dados.
  Superior para o vento e a precipitação a curto prazo em França e nos países
  vizinhos.

### Cadeias de fornecedores

As cadeias combinam os pontos fortes de vários fornecedores na mesma tabela:

- **OpenWeather → AROME-HD → Open-Meteo**: dados em tempo real do OpenWeather
  para a primeira hora, a precisão hiperlocal do AROME para as 47 horas
  seguintes e o Open-Meteo para o resto da previsão. Precisa de uma chave do
  OpenWeather; sem ela a opção fica desativada no seletor.

Escolhe conforme o que precisas: exatidão em tempo real (OpenWeather), precisão
local (AROME-HD) ou planear a longo prazo (Open-Meteo).

---

## 5. Usá-la no navegador

A web app funciona em qualquer navegador atual, no computador ou no telemóvel,
em <https://app.meteoride.cc>. Não há nada para instalar.

Para a app de iPhone ou Android, instala-a a partir da App Store ou com o APK do
GitHub; os passos estão em [`docs/INSTALL.md`](INSTALL.md).

---

## 6. Na app para iPhone e Android

Isto só existe dentro da app nativa: são coisas que um navegador não consegue
fazer.

### 6.1 Enviar o percurso para outra app

Com um percurso carregado, o botão **📤** na barra superior abre a folha de
partilha do sistema com o GPX anexado. Daí segue para o teu ciclocomputador
(Hammerhead, Wahoo), para Ficheiros, para o e-mail, para onde quiseres. O
ficheiro nunca sai do dispositivo: não há nenhum servidor intermédio, ao
contrário do Atalho do iOS de que o site precisa.

### 6.2 Receber um percurso de outra app

Também ao contrário: no Komoot, no Strava, no Bikemap, em Ficheiros ou no
e-mail, partilha o GPX e escolhe **MeteoRide**. A app abre com o percurso já
carregado. O mesmo para "Abrir no MeteoRide" a partir de um ficheiro
descarregado.

Se o MeteoRide não aparecer na folha de partilha da primeira vez, reinicia o
telemóvel: o sistema demora algum tempo a registar a app como destino.

### 6.3 Avisos quando o tempo no teu percurso muda

Uma previsão é uma estimativa feita com horas de antecedência. Quando calculas
um percurso, a app continua a vigiá-lo e avisa-te se piorar nas horas em que
vais andar:

- Estava seco e aparece chuva, ou a chuva passa a forte.
- Estava calmo e aparece vento moderado ou forte, ou rajadas a partir de cerca
  de 43 km/h.
- É emitido um aviso oficial que coincide com a tua volta. Isto precisa de uma
  chave do OpenWeather e dos avisos oficiais ativados.

Cada mudança é avisada uma vez; se voltar a piorar, voltas a saber. As melhorias
não são avisadas, nem os troços que já percorreste. A vigilância termina uma
hora depois do último ponto do percurso.

Liga-a e desliga-a em **Definições → Avisos → "Avisa-me se o tempo no percurso
mudar"**, ligado de origem, onde uma linha por baixo diz que percurso está a ser
vigiado e até quando.

**Convém saber:** a verificação é feita pelo sistema operativo quando lhe
apetece, não pela app. No iPhone, a Atualização em segundo plano tem de estar
ativada para o MeteoRide (Definições → Geral), e o Modo de baixo consumo
suspende-a. No Android, alguns fabricantes matam as tarefas em segundo plano
com o seu próprio gestor de bateria. Quando o sistema não a vai correr, a app
di-lo por baixo do interruptor em vez de te deixar acreditar que estás a ser
vigiado.

### 6.4 Sem rede

O tempo não se pode inventar, mas o que já foi descarregado não se deita fora:

- Ao abrir a app, volta o último percurso com a sua tabela, sem carregar nada.
- Uma previsão antiga continua a aparecer, com a indicação de quantas horas tem.
  Para nas doze.
- O fundo do mapa precisa de ligação. Os mosaicos que viste só ficam guardados
  durante o tempo que o servidor do mapa permite (os termos do OpenStreetMap
  proíbem o uso sem ligação), por isso sem rede o fundo pode ficar em branco; o
  mapa di-lo, e o percurso e a tabela continuam a aparecer.
- Quando não há dados nenhuns, di-lo em vez de deixar um ecrã vazio sem
  explicação.

O botão **📴** guarda a previsão do percurso que tens carregado e protege-a da
limpeza automática da cache. Carrega nele em casa antes de saíres.

### 6.5 Mapa e definições

- Sem nenhum percurso carregado, o mapa abre onde estás e não em Barcelona.
- A app começa no idioma do telemóvel até escolheres um à mão.
- As unidades, o idioma, a tua chave de API, os percursos recentes e os
  mosaicos que já viste ficam guardados fora do navegador interno, numa forma
  que o WebKit conserva: sobrevivem a que o sistema recupere espaço e no iPhone
  continuam lá quando voltas a abrir a app. Antes não era assim.
- Da primeira vez que o mapa te procura, o sistema pede a permissão de
  localização em nome do MeteoRide.
- O telemóvel fica na vertical, porque rodá-lo estraga a disposição. O iPad
  roda.

---

## 7. Definições

### 7.1 Chaves de API

Só o OpenWeather precisa de chave, e só se quiseres esse fornecedor ou os avisos
oficiais. Obtém-se gratuitamente em
[openweathermap.org/api](https://openweathermap.org/api) (One Call API).

Ao lado do campo há um botão **🔍 Verificar**: a app faz um pedido simples e
mostra o estado ao lado (válida / inválida / quota / código HTTP). Usa-o antes
de saíres de casa se acabaste de criar a chave; o OpenWeather demora algum tempo
a ativá-las.

### 7.2 Avisos não críticos

A caixa **Mostrar avisos não críticos** controla o nível de pormenor das
notificações. Ativada, vês faixas informativas quando se recorre a uma
alternativa por limites de horizonte, quota ou erros da API. Desativada, só são
mostrados os erros críticos.

### 7.3 Unidades

- **Vento:** km/h, m/s, mph
- **Temperatura:** °C, °F
- **Distância:** km, mi
- **Chuva:** mm, in

### 7.4 Idiomas

A aplicação está disponível em espanhol, inglês, catalão, galego, basco,
francês, alemão, italiano e português. O idioma escolhido muda a interface e as
mensagens. Na app nativa, enquanto não escolheres um à mão, é usado o do
telemóvel.

### 7.5 Botão de depuração

**Definições → Mostrar botão de depuração** liga o botão 🐞. Vem desligado. Serve
para anexar informação quando comunicas um problema.

---

## 8. Interpretar os dados

### 8.1 A tabela do tempo

A tabela mostra a informação hora a hora:

- **Primeira linha:** hora e distância acumulada.
- **Segunda linha:** ícones do tempo, com os indicadores de mudança de
  fornecedor quando os houver.
- **Temperatura:** em graus Celsius ou Fahrenheit.
- **Vento:** velocidade + seta de direção; rajadas entre parênteses.
- **Chuva:** quantidade em mm/h **da hora em que vais estar a pedalar**
  (probabilidade entre parênteses). Não é a leitura mais próxima do minuto exato
  do passo, mas a da hora inteira durante a qual vais percorrer esse troço.
- **Humidade:** percentagem de humidade relativa.
- **Nebulosidade:** percentagem de cobertura de nuvens.
- **Luminosidade:** uma barra vertical junto ao ícone do tempo, na segunda
  linha. Representa 0-100% da luz disponível nesse intervalo.
- **UV:** índice ultravioleta (inteiro), na linha combinada "Nuvens / UV".

### 8.2 Indicadores de mudança de fornecedor

Quando a fonte dos dados muda durante o percurso, vês uma etiqueta abreviada por
cima dos dados dessa coluna:

- **OPM** — Open-Meteo
- **ARM** — AROME-HD
- **OPW** — OpenWeather

Aparecem no modo normal, ao comparar fornecedores e ao comparar datas, e marcam
exatamente que fornecedor dá os dados de cada segmento de tempo. São
especialmente úteis com as cadeias, em que se combinam várias fontes.

### 8.3 O mapa

- **Setas azuis:** vento fraco (<12 km/h)
- **Setas vermelhas:** vento forte (30-50 km/h)
- **Setas roxas:** vento muito forte (>50 km/h)
- **Gotas 💧:** precipitação prevista
- **Marcadores verde/vermelho:** início e fim do percurso

---

## 9. Funções avançadas

### 9.1 Deslizar a tabela na horizontal

A tabela é interativa e pensada para ecrãs táteis:

- Arrasta a tabela na horizontal ou usa a roda do rato para percorrer as
  colunas (gestos e *drag-to-scroll*).
- Clica em qualquer coluna —ou em qualquer célula, para escolher essa coluna— e
  a linha e o mapa ficam destacados.
- O mapa recentra-se no ponto escolhido se clicares numa seta de vento ou na
  coluna.
- Se a penúltima coluna estiver a menos de 5 minutos da última, a app esconde-a
  para evitar duplicados visuais.
- O pequeno ícone ⇆ indica que há mais colunas disponíveis ao deslizar.

### 9.2 Informação solar

A app mostra automaticamente:

- As horas do nascer e do pôr do sol.
- O crepúsculo civil, marcado com "c".
- A luminosidade calculada segundo a hora e as condições.

### 9.3 Alternativas inteligentes

O MeteoRide trata automaticamente de:

- Passar para o Open-Meteo, **só nos passos afetados**, se o teu fornecedor
  ultrapassar o seu horizonte temporal, falhar repetidamente ou não tiver dados
  para esse ponto.
- Repetir os pedidos quando há erros temporários.
- Um breve aviso no cabeçalho quando isso acontece, se deixares os avisos não
  críticos ligados nas Definições ([§7.2](#72-avisos-não-críticos)).

Cada pedido tem um prazo: **15 segundos** para o servidor começar a responder e
**outros 15 segundos** sem receber dados durante a descarga. Um fornecedor que
se cala não volta a ser consultado nesse mesmo cálculo: os passos que faltam vão
diretamente para a alternativa em vez de esperarem que ele esgote o tempo uma e
outra vez.

### 9.4 URLs com parâmetros

Podes abrir o MeteoRide com o percurso e os parâmetros já definidos:

- `?gpx_url=https://example.com/route.gpx`
- `?datetime=2024-03-15T10:00`
- `?speed=25`

Podem ser combinados. O GPX é descarregado pelo navegador diretamente desse URL:
o MeteoRide não o carrega para lado nenhum.

### 9.5 Percursos recentes

O MeteoRide guarda localmente os ficheiros GPX que carregaste mais recentemente
para os poderes recuperar sem voltares a carregar o ficheiro.

- **Como usar:** ao lado do botão 📁 há uma lista com os teus percursos
  recentes. Escolhe um e carrega exatamente como se o tivesses carregado agora.
- **Limite:** ficam guardados os últimos **5** percursos. Voltar a carregar um
  percurso que já está guardado passa-o para o topo em vez de o duplicar.
- **Tamanho recomendado:** até cerca de **750 KB** por GPX. Se o teu for muito
  maior, reduz-o ou aloja-o e carrega-o com `?gpx_url=`.
- **Privacidade:** os ficheiros GPX ficam guardados no teu navegador com o
  IndexedDB (ou o localStorage como alternativa). Nunca são partilhados fora do
  teu dispositivo.
- **Eficiência:** só a informação básica (nome, tamanho e data) fica em memória;
  o conteúdo completo só é lido quando escolhes o percurso.

### 9.6 Cache local e desempenho

As respostas dos fornecedores ficam guardadas no `localStorage` durante cerca de
**30 minutos** por passo/hora. Isto acelera os recarregamentos frequentes e
reduz os pedidos às APIs com limite de pedidos. Expira sozinha: não há nada para
limpar à mão.

---

## 10. Limitações e dicas

### Limitações

- **Horizonte temporal:** Open-Meteo 14 dias, OpenWeather 4 dias, AROME-HD 36
  horas.
- **Exatidão:** a partir do dia 3-4 as previsões são bastante menos fiáveis.
- **APIs gratuitas:** o Open-Meteo não precisa de chave e não tem um limite
  prático; o OpenWeather oferece um nível gratuito, mas as chaves podem ter
  limites de utilização mensais.
- **O MeteoRide não edita o percurso.** Só lê o GPX/KML.

### Boas práticas

- Usa percursos de 100-200 km no máximo para um melhor desempenho.
- Planeia com 1-2 dias de antecedência para maior exatidão.
- Combina a informação de várias fontes nas decisões importantes.
- Tem sempre um plano B para condições adversas.
- Leva roupa de chuva mesmo que a probabilidade seja baixa.

---

## 11. Avisos meteorológicos oficiais

O MeteoRide pode mostrar os avisos e alertas oficiais publicados pelos serviços
meteorológicos nacionais, quando aparecem no array `alerts` do OpenWeather.

Para os ativar: introduz a tua **chave de API do OpenWeather** nas Definições e
marca **Mostrar avisos meteorológicos oficiais**.

- **Disponibilidade:** precisa de uma chave do OpenWeather, porque é o único
  fornecedor que os publica. Com a chave configurada, o MeteoRide procura avisos
  mesmo quando o OpenWeather não é o fornecedor principal que escolheste. Sem
  chave a caixa fica desativada e diz porquê.
- **Visibilidade:** quando é detetado um aviso aparece um cartão informativo que
  se esconde sozinho ao fim de 15 segundos. Fica na interface um indicador
  **⚠️** permanente para poderes voltar a abrir todos os avisos detetados.
- **Amostragem e eficiência:** para limitar as chamadas à API é verificada uma
  amostra representativa de pontos ao longo do percurso (aprox. 2/3 dos passos,
  no mínimo 3). As respostas de avisos ficam em cache localmente durante ~1
  hora.
- **Janela temporal:** só são tidos em conta os avisos cujo período
  (início/fim) coincide com a janela temporal do troço do percurso
  correspondente, com uma tolerância de ±1 hora à volta do passo.

> **Aviso importante.** Estes avisos são fornecidos só a título informativo. Não
> confies apenas neles para decisões de segurança. Consulta sempre o serviço
> meteorológico oficial do teu país ou as autoridades competentes antes de
> fazeres uma atividade que possa ser afetada por condições severas. O
> OpenWeather pode ter erros ou atrasos, ou omitir avisos locais específicos; o
> MeteoRide não substitui as comunicações oficiais.

---

## 12. Resolução de problemas

| Sintoma | O que verificar |
|---|---|
| O GPX/KML não carrega | Verifica que o ficheiro tem trajetos válidos. |
| Sem dados meteorológicos | Verifica a tua chave de API com 🔍 Verificar, ou muda para o Open-Meteo, que não precisa de chave. |
| Data fora do intervalo | Reduz o horizonte temporal: cada fornecedor tem o seu ([§4](#4-fornecedores-meteorológicos)). |
| Tabela vazia | Confirma que o percurso é suficientemente longo para pelo menos um passo. |
| Um percurso partilhado não chega à app | Reinicia o telemóvel da primeira vez ([§6.2](#62-receber-um-percurso-de-outra-app)). |
| Os avisos de mudança do tempo não chegam | Lê o que a app diz por baixo do interruptor ([§6.3](#63-avisos-quando-o-tempo-no-teu-percurso-muda)). |

Para comunicar um problema, liga o botão de depuração
([§7.5](#75-botão-de-depuração)) e indica o teu dispositivo e a versão, que
aparece no fundo da página de ajuda.

---

## 13. Privacidade e dados

A política propriamente dita — o que recebe cada fornecedor, quanto tempo o
guarda e como apagar tudo o que fica no dispositivo — é
[a do site](https://app.meteoride.cc/privacy-web-pt.html),
[a do iOS](https://app.meteoride.cc/privacy-ios-pt.html) e
[a do Android](https://app.meteoride.cc/privacy-android-pt.html) — uma por plataforma, que é
o que se entrega no formulário de cada loja, e as apps são mais fechadas do que o site. Esta
secção é o resumo; a política é o que tem de estar certo.

**O MeteoRide funciona inteiramente no teu dispositivo.** Todas as definições,
preferências e dados ficam guardados só no teu dispositivo: no site, no
navegador (localStorage e IndexedDB), e na app também no armazenamento próprio
do sistema, para que o iOS não possa apagar as definições.

A única exceção é o site: se usares os Atalhos do iOS para partilhar um GPX, esse
ficheiro é carregado para a Cloudflare. É inevitável porque os Atalhos do iOS
só aceitam POST. Se abrires o ficheiro diretamente no MeteoRide não se carrega
nada, porque é processado localmente, e a app nativa não precisa de nada disto.
Em qualquer caso o GPX carregado é apagado automaticamente no máximo em dois
minutos.

- **Sem conta:** não precisas de criar uma conta nem de dar dados pessoais.
- **Controlo total:** no site, apaga os dados do site nas definições do teu
  navegador; na app, desinstala-a (iPhone) ou apaga o armazenamento dela
  (Android). A política da tua plataforma explica o que acontece às cópias de
  segurança.
- **Código aberto:** podes inspecionar o código-fonte completo no GitHub.

### Dados partilhados com os fornecedores meteorológicos

Para obter as previsões, o MeteoRide só partilha:

- As **coordenadas geográficas** dos pontos do teu percurso.
- As **datas e horas** para as quais precisas da previsão.
- **A tua chave de API**, se usares o OpenWeather.

Os fornecedores meteorológicos (Open-Meteo, OpenWeather) têm as suas próprias
políticas de privacidade. O MeteoRide só atua como um cliente que pede os dados
de previsão de que precisas.

### Sobre a chave de API

A chave fica guardada no armazenamento local do teu dispositivo, **sem cifrar**.
Isso significa que, em teoria, poderia ser acedida por um terceiro com acesso ao
teu dispositivo, ou por outro script a correr no teu navegador. O risco com este
tipo de chave é baixo, mas recomenda-se usar uma chave gratuita com permissões
mínimas. Em alternativa, podes dispensar as chaves por completo e usar os
fornecedores que não as pedem (Open-Meteo, AROME-HD).

### O que fica guardado localmente

- As definições de unidades e idioma.
- As chaves de API, sem cifrar.
- As preferências de velocidade e intervalo.
- Uma cache temporária dos dados meteorológicos (~30 minutos).
- Os últimos 5 percursos GPX carregados.
- Na app nativa, também os mosaicos do mapa que viste, cada um até à expiração
  que o seu servidor lhe deu.

Se precisas de garantias de privacidade mais rigorosas, podes correr o MeteoRide
inteiramente em local (abrindo `index.html` sem usar as funções de
partilha/carregamento) ou publicar o teu próprio share-server com as políticas
de acesso que decidires ([DEPLOY.md](DEPLOY.md)).

---

## 14. Licença e créditos

Desenvolvido por [Lockevod](https://github.com/lockevod).

### Licença

Este projeto está licenciado sob a **licença MIT**, o que significa que:

- Podes usar a aplicação livremente.
- Podes modificar o código-fonte.
- Podes distribuir a tua própria versão.
- Para uso pessoal e comercial.
- Tens de indicar o autor e a licença MIT.

### Tecnologias e serviços

- **Mapas:** OpenStreetMap e colaboradores.
- **Dados meteorológicos:** Open-Meteo, OpenWeather.
- **Ícones do tempo:** Weather Icons de Erik Flowers.
- **Bibliotecas:** Leaflet.js, SunCalc, GPX parser.
- **App nativa:** Capacitor (iOS / Android).
- **Alojamento:** Cloudflare Pages (só a versão web).
- **Scripts:** Tampermonkey.

### Marcas e responsabilidade

Bikemap, Komoot, OpenWeatherMaps, Openmeteo e Hammerhead são marcas registadas.
Podem ter licenças proprietárias específicas; se usares este código ou a webapp
publicada, tens de as cumprir.

Este código e a webapp foram pensados com uma segurança do tipo "zero trust",
mas não são código comercial nem um serviço comercial. O código e a webapp são
fornecidos tal como estão, sem qualquer garantia nem responsabilidade. Aceitas
isto se descarregares este repositório, usares o código ou usares a webapp.

A informação atualizada sobre esta app está sempre no
[GitHub](https://github.com/lockevod/MeteoRide). Se usares esta app, aceitas
toda a informação, responsabilidades e restrições atualizadas dessa página.

### Exoneração de responsabilidade

O MeteoRide é uma ferramenta de planeamento. Os dados meteorológicos são
estimativas e podem não ser totalmente exatos. Usa sempre o teu bom senso e
confirma as condições antes de saíres. O programador não é responsável por
decisões tomadas com base nesta informação.

---

## 15. Suporte e contribuições

### Comunicar problemas

- Abre um issue no
  [repositório do GitHub](https://github.com/lockevod/MeteoRide/issues).
- Liga o botão de depuração (🐞) em **Definições → Mostrar botão de depuração**:
  vem desligado.
- Indica o teu dispositivo e a versão, que aparece no fundo da página de ajuda.

### Contribuir

- Faz um fork do repositório no GitHub.
- Comunica erros ou sugere melhorias.
- Traduz para novos idiomas.
- Melhora a documentação.

O tempo pode mudar depressa. Usa o MeteoRide como guia, mas mantém-te flexível e
seguro nas tuas voltas.
