import React, {CSSProperties} from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

export const TOUR_WIDTH = 1280;
export const TOUR_HEIGHT = 720;
export const TOUR_FPS = 30;
const SCENE_FRAMES = 210;
const SCENE_STEP = 190;
export const TOUR_DURATION = (7 * SCENE_STEP) + SCENE_FRAMES;

const C = {
  bg: '#10141a',
  surface: '#171c23',
  surface2: '#202630',
  surface3: '#29313d',
  line: 'rgba(215,226,245,.12)',
  text: '#f4f7fc',
  muted: '#b4c0d1',
  blue: '#8eafff',
  blueDeep: '#2457d6',
  cyan: '#8ed9ec',
  green: '#8ed8b0',
  amber: '#f2d29a',
};

const scenes = [
  {
    eyebrow: 'SEU ESPAÇO PARA CONVERSAR',
    title: 'SeuChatSeguro',
    description: 'Uma apresentação rápida do que você encontra por aqui.',
    kind: 'intro',
  },
  {
    eyebrow: '01 · SUA CONTA',
    title: 'Comece sem número de telefone.',
    description: 'Crie uma conta com nome e senha. Guarde as 12 palavras para recuperar o acesso.',
    kind: 'account',
  },
  {
    eyebrow: '02 · CONVERSAS',
    title: 'Converse com mais controle.',
    description: 'Mensagens com criptografia de ponta a ponta, histórico cifrado neste aparelho e opção de expiração.',
    kind: 'chat',
  },
  {
    eyebrow: '03 · GRUPOS',
    title: 'Junte pessoas. Organize a conversa.',
    description: 'Grupos de até 20 pessoas, com cargos, permissões e menções.',
    kind: 'groups',
  },
  {
    eyebrow: '04 · ÁUDIO E CHAMADAS',
    title: 'Mais que mensagens de texto.',
    description: 'Envie áudios e arquivos. Faça chamadas de voz ou vídeo e, em navegadores compatíveis, compartilhe a tela.',
    kind: 'calls',
  },
  {
    eyebrow: '05 · HOJE E MÚSICA',
    title: 'Uma rotina mais completa.',
    description: 'Veja clima e notícias. Descubra faixas no Audius e prévias no iTunes.',
    kind: 'daily',
  },
  {
    eyebrow: '06 · ASSISTENTE NODIA',
    title: 'Ideias para seguir em frente.',
    description: 'Organize ideias e explore possibilidades. As mensagens seguem ao provedor de IA com seu consentimento.',
    kind: 'nodia',
  },
  {
    eyebrow: 'SEU PRÓXIMO PASSO',
    title: 'A conversa começa com você.',
    description: 'Crie sua conta, guarde as palavras de recuperação e conheça o SeuChatSeguro.',
    kind: 'outro',
  },
] as const;

type SceneKind = (typeof scenes)[number]['kind'];

const iconPaths: Record<string, React.ReactNode> = {
  lock: <><path d="M6 10V7a6 6 0 0 1 12 0v3"/><rect x="4" y="10" width="16" height="11" rx="2.5"/><circle cx="12" cy="15.5" r="1"/></>,
  chat: <><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.8 8.8 0 0 1-4-.9L4 20l1.3-3.1A7.3 7.3 0 0 1 4 12a7.8 7.8 0 0 1 8-7.5c4.4 0 8 3.1 8 7Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/></>,
  phone: <><path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M10 17h4"/></>,
  mic: <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></>,
  music: <><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
  users: <><path d="M16 20v-1.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4V20M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-7.5a4 4 0 0 1 0 7.7M20 20v-1.5a4 4 0 0 0-3-3.9"/></>,
  sparkle: <><path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/></>,
  close: <><path d="m6 6 12 12M18 6 6 18"/></>,
};

const Icon: React.FC<{name: string; size?: number; color?: string}> = ({name, size = 22, color = 'currentColor'}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>
);

const textStyle = (size: number, weight = 500, color: string = C.text): CSSProperties => ({
  margin: 0,
  color,
  fontFamily: 'Inter, Arial, sans-serif',
  fontSize: size,
  fontWeight: weight,
  letterSpacing: '-0.035em',
});

const card: CSSProperties = {
  background: `linear-gradient(145deg, rgba(31,38,49,.98), rgba(20,25,32,.98))`,
  border: `1px solid ${C.line}`,
  borderRadius: 28,
  boxShadow: '0 30px 90px rgba(0,0,0,.36)',
};

const Pill: React.FC<{children: React.ReactNode; color?: string; bg?: string}> = ({children, color = C.blue, bg = 'rgba(142,175,255,.12)'}) => (
  <span style={{display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 999, color, background: bg, border: `1px solid ${color}28`, fontSize: 15, fontWeight: 650, letterSpacing: '.01em', whiteSpace: 'nowrap'}}>{children}</span>
);

const Dot: React.FC<{color?: string; size?: number}> = ({color = C.green, size = 8}) => <span style={{width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', boxShadow: `0 0 14px ${color}70`}} />;

const Window: React.FC<{children: React.ReactNode; width?: number; height?: number}> = ({children, width = 570, height = 446}) => (
  <div style={{...card, width, height, overflow: 'hidden', display: 'flex', flexDirection: 'column', fontFamily: 'Inter, Arial, sans-serif'}}>
    <div style={{height: 47, display: 'flex', alignItems: 'center', gap: 8, padding: '0 19px', borderBottom: `1px solid ${C.line}`, background: 'rgba(255,255,255,.018)'}}>
      <Dot color="#fa7b72" size={8}/><Dot color="#f1c36f" size={8}/><Dot color="#74c99d" size={8}/>
      <span style={{marginLeft: 10, color: '#98a5b7', fontSize: 13, fontWeight: 550, letterSpacing: '.02em'}}>seuchatseguro.app</span>
      <span style={{marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: '#9fabbc', fontSize: 12}}><Icon name="lock" size={14}/> privado</span>
    </div>
    <div style={{flex: 1, minHeight: 0, position: 'relative'}}>{children}</div>
  </div>
);

const Field: React.FC<{label: string; value: string; accent?: boolean}> = ({label, value, accent = false}) => (
  <div style={{display: 'grid', gap: 7}}>
    <span style={{fontSize: 15, color: C.muted, fontWeight: 600}}>{label}</span>
    <div style={{height: 48, borderRadius: 12, border: `1px solid ${accent ? 'rgba(142,175,255,.56)' : C.line}`, background: 'rgba(7,10,15,.35)', display: 'flex', alignItems: 'center', padding: '0 14px', color: value === '••••••••••' ? '#77869a' : C.text, fontSize: 16}}>{value}</div>
  </div>
);

const Brand: React.FC<{compact?: boolean}> = ({compact = false}) => (
  <div style={{display: 'flex', alignItems: 'center', gap: 11}}>
    <Img src={staticFile('brand-mark-blue-27.svg')} style={{width: compact ? 34 : 42, height: compact ? 34 : 42}} />
    <span style={{fontSize: compact ? 20 : 23, color: C.text, fontWeight: 700, letterSpacing: '-.04em'}}>SeuChat<span style={{color: C.blue}}>Seguro</span></span>
  </div>
);

const Background: React.FC<{accent?: string}> = ({accent = '36,87,214'}) => (
  <AbsoluteFill style={{background: `radial-gradient(ellipse at 82% 25%, rgba(${accent},.18), transparent 38%), radial-gradient(ellipse at 14% 94%, rgba(142,175,255,.08), transparent 34%), ${C.bg}`}}>
    <div style={{position: 'absolute', inset: 0, opacity: .15, backgroundImage: 'linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)', backgroundSize: '80px 80px', maskImage: 'linear-gradient(90deg, black, transparent 80%)'}} />
    <div style={{position: 'absolute', width: 530, height: 530, border: '1px solid rgba(185,207,255,.08)', borderRadius: '50%', right: -190, top: -300}} />
    <div style={{position: 'absolute', width: 390, height: 390, border: '1px solid rgba(185,207,255,.06)', borderRadius: '50%', right: -120, top: -230}} />
  </AbsoluteFill>
);

const Sidebar: React.FC = () => (
  <div style={{width: 64, borderRight: `1px solid ${C.line}`, background: 'rgba(7,10,15,.22)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 17, paddingTop: 22}}>
    {['chat', 'users', 'sun', 'music', 'sparkle'].map((name, i) => <div key={name} style={{width: 36, height: 36, borderRadius: 12, display: 'grid', placeItems: 'center', background: i === 0 ? 'rgba(142,175,255,.14)' : 'transparent', color: i === 0 ? C.blue : '#778497'}}><Icon name={name} size={18}/></div>)}
    <div style={{marginTop: 'auto', marginBottom: 18, width: 31, height: 31, borderRadius: 12, background: 'linear-gradient(135deg,#6083d9,#3d5076)', display: 'grid', placeItems: 'center', color: 'white', fontWeight: 700, fontSize: 13}}>EU</div>
  </div>
);

const MessageBubble: React.FC<{children: React.ReactNode; mine?: boolean; time?: string}> = ({children, mine = false, time = '14:32'}) => (
  <div style={{alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '77%', display: 'grid', gap: 5}}>
    <div style={{padding: '12px 15px', borderRadius: mine ? '17px 17px 5px 17px' : '17px 17px 17px 5px', background: mine ? '#315fc7' : '#252c36', color: C.text, fontSize: 16, lineHeight: 1.45, boxShadow: '0 4px 14px rgba(0,0,0,.13)'}}>{children}</div>
    <span style={{fontSize: 11, color: '#8995a6', alignSelf: mine ? 'flex-end' : 'flex-start'}}>{time}</span>
  </div>
);

const AccountUI: React.FC = () => (
  <div style={{width: 490}}>
    <div style={{...card, padding: 24, width: 440, display: 'grid', gap: 12}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 12, marginBottom: 2}}><span style={{width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 14, background: 'rgba(142,175,255,.12)', color: C.blue}}><Icon name="lock" size={22}/></span><div><b style={{display: 'block', color: C.text, fontSize: 20}}>Criar sua conta</b><span style={{color: C.muted, fontSize: 13}}>Seu espaço começa aqui</span></div></div>
      <Field label="Seu nome" value="Como os amigos vão te ver" accent/>
      <Field label="Crie uma senha" value="••••••••••"/>
      <div style={{borderRadius: 12, padding: '10px 12px', background: 'rgba(142,175,255,.09)', border: '1px solid rgba(142,175,255,.16)', color: '#c9d9ff', fontSize: 13, lineHeight: 1.4}}>Sem telefone/SMS: use seu número exclusivo ou um QR para encontrar contatos.</div>
      <div style={{height: 42, display: 'grid', placeItems: 'center', borderRadius: 12, background: 'linear-gradient(100deg,#356be5,#2457d6)', color: 'white', fontSize: 15, fontWeight: 700}}>Criar conta</div>
      <div style={{display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'rgba(142,216,176,.08)', border: '1px solid rgba(142,216,176,.18)'}}>
        <Icon name="lock" size={18} color={C.green}/>
        <div><b style={{display: 'block', color: '#d5f1e0', fontSize: 13}}>12 palavras de recuperação</b><span style={{display: 'block', color: '#aebbaa', fontSize: 11, marginTop: 2}}>Guarde-as em local seguro.</span></div>
        <span style={{marginLeft: 'auto', color: C.green, fontSize: 12, fontWeight: 700}}>12 / 12</span>
      </div>
    </div>
  </div>
);

const ChatUI: React.FC = () => (
  <Window>
    <div style={{display: 'flex', height: '100%'}}>
      <Sidebar/>
      <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column'}}>
        <div style={{height: 64, borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 11, padding: '0 21px'}}>
          <div style={{width: 34, height: 34, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#6689d9,#465778)', color: 'white', fontSize: 13, fontWeight: 700}}>L</div>
          <div><b style={{display: 'block', color: C.text, fontSize: 15}}>Lia</b><span style={{color: C.green, fontSize: 11}}>disponível</span></div>
          <span style={{marginLeft: 'auto'}}><Pill><Icon name="lock" size={14}/> ponta a ponta</Pill></span>
        </div>
        <div style={{flex: 1, padding: '21px 23px', display: 'flex', flexDirection: 'column', gap: 11, background: 'radial-gradient(ellipse at 55% 0%,rgba(54,107,229,.07),transparent 60%)'}}>
          <span style={{alignSelf: 'center', color: '#7f8da0', fontSize: 11, marginBottom: 3}}>Hoje</span>
          <MessageBubble>Oi! Você viu o arquivo que te enviei?</MessageBubble>
          <MessageBubble mine time="14:33">Vi sim. Obrigado por mandar!</MessageBubble>
          <div style={{marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 9, border: `1px solid ${C.line}`, borderRadius: 14, padding: '10px 12px', background: 'rgba(8,11,16,.32)'}}><span style={{color: C.muted, fontSize: 13, flex: 1}}>Escreva uma mensagem…</span><span style={{width: 28, height: 28, display: 'grid', placeItems: 'center', background: C.blueDeep, color: 'white', borderRadius: 9}}><Icon name="arrow" size={15}/></span></div>
        </div>
      </div>
    </div>
  </Window>
);

const GroupUI: React.FC = () => (
  <Window>
    <div style={{padding: 24, height: '100%', display: 'flex', flexDirection: 'column', gap: 18, background: 'radial-gradient(ellipse at 80% 0%,rgba(142,175,255,.09),transparent 50%)'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 13}}>
        <div style={{width: 58, height: 58, borderRadius: 18, background: 'linear-gradient(145deg,#5876bc,#263856)', display: 'grid', placeItems: 'center', color: 'white'}}><Icon name="users" size={29}/></div>
        <div style={{flex: 1}}><b style={{display: 'block', color: C.text, fontSize: 22, letterSpacing: '-.03em'}}>Equipe criativa</b><span style={{color: C.muted, fontSize: 13}}>12 pessoas · conversa do grupo</span></div>
        <Pill color={C.green} bg="rgba(142,216,176,.1)">até 20</Pill>
      </div>
      <div style={{height: 1, background: C.line}}/>
      <div style={{display: 'flex', alignItems: 'center', gap: 10}}>{[['MA','#a7789e'],['BR','#478a98'],['LU','#b47d51'],['+9','#4c5d79']].map(([name, color]) => <div key={name} style={{width: 40, height: 40, borderRadius: 14, display: 'grid', placeItems: 'center', background: `linear-gradient(145deg,${color},#29313d)`, color: 'white', fontWeight: 700, fontSize: 12, border: `2px solid ${C.surface}`}}>{name}</div>)}<span style={{color: C.muted, fontSize: 13}}>participantes</span></div>
      <div style={{flex: 1, minHeight: 0, display: 'grid', gap: 12, alignContent: 'start'}}>
        <div style={{maxWidth: '82%', padding: 15, borderRadius: '16px 16px 16px 4px', background: '#252c36', color: C.text, fontSize: 14, lineHeight: 1.45}}><b style={{fontSize: 12, color: C.blue, display: 'block', marginBottom: 4}}>BRUNO · MODERADOR</b>Fechamos a primeira versão. Alguém revisa o visual?</div>
        <div style={{maxWidth: '82%', justifySelf: 'end', padding: 15, borderRadius: '16px 16px 4px 16px', background: '#315fc7', color: 'white', fontSize: 14, lineHeight: 1.45}}><b style={{fontSize: 12, color: '#d7e3ff', display: 'block', marginBottom: 4}}>VOCÊ</b><span style={{color: '#dce7ff', fontWeight: 700}}>@Lia</span> pode revisar a tela de entrada?</div>
      </div>
      <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}><Pill color={C.blue}>Cargos e permissões</Pill><Pill color={C.cyan} bg="rgba(142,217,236,.09)">@menções</Pill><Pill color={C.amber} bg="rgba(242,210,154,.09)">Convites</Pill></div>
    </div>
  </Window>
);

const CallsUI: React.FC = () => (
  <Window>
    <div style={{height: '100%', padding: 18, display: 'flex', flexDirection: 'column', gap: 13, background: 'radial-gradient(ellipse at 50% 0%,rgba(142,175,255,.12),transparent 54%)'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 9, color: C.text, fontSize: 14, fontWeight: 650}}><span style={{width: 8, height: 8, borderRadius: 99, background: C.green}}/> Chamada de vídeo <span style={{marginLeft: 'auto', color: C.muted, fontSize: 12}}>12:48</span></div>
      <div style={{flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11, minHeight: 0}}>
        <div style={{borderRadius: 19, overflow: 'hidden', display: 'flex', alignItems: 'flex-end', padding: 15, background: 'radial-gradient(ellipse at 50% 35%,#b3a7a3 0 12%,transparent 13%), radial-gradient(ellipse at 51% 69%,#344761 0 22%,transparent 23%), linear-gradient(150deg,#9b817b,#384859 62%,#18202a)'}}><span style={{padding: '6px 9px', background: 'rgba(0,0,0,.5)', borderRadius: 8, color: 'white', fontSize: 12}}>Lia</span></div>
        <div style={{borderRadius: 19, overflow: 'hidden', display: 'flex', alignItems: 'flex-end', padding: 15, background: 'radial-gradient(ellipse at 50% 35%,#bd987e 0 12%,transparent 13%), radial-gradient(ellipse at 50% 69%,#41505e 0 22%,transparent 23%), linear-gradient(150deg,#a78a78,#4a5261 60%,#1d242d)'}}><span style={{padding: '6px 9px', background: 'rgba(0,0,0,.5)', borderRadius: 8, color: 'white', fontSize: 12}}>Você</span></div>
      </div>
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 13}}>
        {['mic','video','close'].map((name, i) => <span key={name} style={{width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 15, background: i === 2 ? '#d95759' : '#303947', color: 'white'}}><Icon name={name} size={19}/></span>)}
        <span style={{marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 7, color: C.muted, fontSize: 12}}><Icon name="mic" size={15} color={C.blue}/> áudio e compartilhamento de tela</span>
      </div>
    </div>
  </Window>
);

const DailyUI: React.FC = () => (
  <div style={{width: 580, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13}}>
    <div style={{...card, padding: 19, minHeight: 300, background: 'linear-gradient(155deg,#222b38,#171d25)'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13, fontWeight: 600}}><Icon name="sun" size={18} color={C.amber}/> HOJE · CLIMA</div>
      <div style={{marginTop: 27, display: 'flex', alignItems: 'center', gap: 8}}><span style={{fontSize: 63, fontWeight: 500, letterSpacing: '-.08em', color: C.text}}>24°</span><span style={{fontSize: 24, color: C.amber}}>☀</span></div>
      <div style={{color: C.text, fontSize: 15, fontWeight: 600}}>Sua cidade</div>
      <div style={{height: 1, background: C.line, margin: '18px 0'}}/>
      <div style={{color: C.muted, fontSize: 13, lineHeight: 1.5}}>Notícias do dia</div>
      <div style={{marginTop: 11, padding: 11, borderRadius: 12, background: 'rgba(255,255,255,.045)', color: '#dce4f0', fontSize: 12, lineHeight: 1.45}}>Destaques para acompanhar hoje</div>
      <div style={{marginTop: 10, display: 'flex', gap: 5}}>{['Brasil','Mundo','Ciência'].map((t) => <span key={t} style={{color: '#9eb7ef', background: 'rgba(142,175,255,.08)', padding: '5px 7px', borderRadius: 8, fontSize: 10}}>{t}</span>)}</div>
    </div>
    <div style={{...card, padding: 19, minHeight: 300, background: 'linear-gradient(155deg,#292334,#191922)'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13, fontWeight: 600}}><Icon name="music" size={18} color="#d6b7ff"/> MÚSICA</div>
      <div style={{height: 132, marginTop: 19, borderRadius: 16, background: 'radial-gradient(circle at 50% 40%,rgba(184,149,243,.7),transparent 3%), radial-gradient(circle at 50% 40%,rgba(184,149,243,.22),transparent 42%), linear-gradient(135deg,#282035,#3a3150 58%,#22243b)', display: 'grid', placeItems: 'center'}}><span style={{width: 48, height: 48, borderRadius: 50, display: 'grid', placeItems: 'center', color: 'white', background: 'rgba(255,255,255,.13)', backdropFilter: 'blur(8px)'}}><Icon name="music" size={22}/></span></div>
      <b style={{display: 'block', marginTop: 13, color: C.text, fontSize: 15}}>Descubra algo novo</b>
      <span style={{display: 'block', marginTop: 5, color: C.muted, fontSize: 12}}>Audius · faixas públicas</span>
      <div style={{display: 'flex', alignItems: 'center', gap: 7, marginTop: 17, padding: '10px 11px', border: `1px solid ${C.line}`, borderRadius: 12, color: '#d4c6eb', fontSize: 11}}><Icon name="music" size={15} color="#d6b7ff"/> iTunes · prévias disponíveis</div>
    </div>
    <div style={{gridColumn: '1 / span 2', display: 'flex', alignItems: 'center', gap: 9, paddingLeft: 4, color: '#94a2b5', fontSize: 12}}><Dot color={C.blue}/> Clima e notícias dependem de serviços externos e da sua configuração.</div>
  </div>
);

const NodiaUI: React.FC = () => (
  <Window>
    <div style={{height: '100%', padding: 22, display: 'flex', flexDirection: 'column', background: 'radial-gradient(ellipse at 0% 0%,rgba(142,175,255,.1),transparent 50%)'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16, borderBottom: `1px solid ${C.line}`}}>
        <div style={{width: 42, height: 42, borderRadius: 15, display: 'grid', placeItems: 'center', color: C.blue, background: 'rgba(142,175,255,.12)'}}><Icon name="sparkle" size={22}/></div>
        <div><b style={{display: 'block', fontSize: 16, color: C.text}}>Nodia</b><span style={{fontSize: 12, color: C.muted}}>Assistente do SeuChatSeguro</span></div>
        <Pill color={C.green} bg="rgba(142,216,176,.09)"><Dot color={C.green}/> disponível</Pill>
      </div>
      <div style={{flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16}}>
        <div style={{alignSelf: 'flex-end', maxWidth: '82%', padding: '13px 15px', borderRadius: '17px 17px 5px 17px', background: '#315fc7', color: 'white', fontSize: 14}}>Me ajude a organizar minhas ideias para hoje.</div>
        <div style={{alignSelf: 'flex-start', maxWidth: '88%', display: 'flex', gap: 10, padding: '14px 15px', borderRadius: '17px 17px 17px 5px', background: '#252c36', color: '#e8edf5', fontSize: 14, lineHeight: 1.55}}><Icon name="sparkle" size={18} color={C.blue}/>Claro. Vamos começar pelo que é mais importante para você.</div>
      </div>
      <div style={{padding: '12px 13px', borderRadius: 13, background: 'rgba(242,210,154,.09)', border: '1px solid rgba(242,210,154,.23)', color: '#e5d0a5', fontSize: 12, lineHeight: 1.45}}>Com seu consentimento, o texto segue ao provedor de IA. Evite compartilhar dados sensíveis.</div>
    </div>
  </Window>
);

const OutroUI: React.FC = () => (
  <div style={{...card, width: 500, padding: 34, display: 'grid', gap: 20, textAlign: 'center', justifyItems: 'center', background: 'radial-gradient(ellipse at 50% 0%,rgba(54,107,229,.20),#171c23 64%)'}}>
    <Img src={staticFile('brand-mark-blue-27.svg')} style={{width: 82, height: 82, filter: 'drop-shadow(0 15px 30px rgba(36,87,214,.24))'}}/>
    <div><b style={{display: 'block', color: C.text, fontSize: 25, letterSpacing: '-.04em'}}>SeuChat<span style={{color: C.blue}}>Seguro</span></b><span style={{display: 'block', marginTop: 6, color: C.muted, fontSize: 14}}>Mensagens · grupos · chamadas · Nodia</span></div>
    <div style={{height: 1, width: '82%', background: C.line}}/>
    <Pill color={C.blue}><Icon name="lock" size={16}/> Sua jornada começa aqui</Pill>
  </div>
);

const FeatureUI: React.FC<{kind: SceneKind}> = ({kind}) => {
  if (kind === 'account') return <AccountUI/>;
  if (kind === 'chat') return <ChatUI/>;
  if (kind === 'groups') return <GroupUI/>;
  if (kind === 'calls') return <CallsUI/>;
  if (kind === 'daily') return <DailyUI/>;
  if (kind === 'nodia') return <NodiaUI/>;
  if (kind === 'outro') return <OutroUI/>;
  return <ChatUI/>;
};

const IntroUI: React.FC = () => (
  <div style={{...card, width: 540, height: 405, overflow: 'hidden', padding: 23, display: 'flex', flexDirection: 'column', background: 'linear-gradient(150deg,rgba(36,67,121,.7),rgba(22,28,39,.98) 60%)'}}>
    <div style={{display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 17, borderBottom: `1px solid ${C.line}`}}><Brand compact/><span style={{marginLeft: 'auto'}}><Pill color={C.green} bg="rgba(142,216,176,.09)"><Dot/> online</Pill></span></div>
    <div style={{flex: 1, display: 'grid', placeItems: 'center', position: 'relative'}}>
      <div style={{position: 'absolute', width: 270, height: 270, border: '1px solid rgba(142,175,255,.15)', borderRadius: '50%'}}/>
      <div style={{position: 'absolute', width: 205, height: 205, border: '1px solid rgba(142,175,255,.12)', borderRadius: '50%'}}/>
      <div style={{position: 'relative', display: 'grid', gap: 14, justifyItems: 'center', textAlign: 'center'}}>
        <div style={{width: 80, height: 80, borderRadius: 25, display: 'grid', placeItems: 'center', background: 'rgba(142,175,255,.14)', border: '1px solid rgba(142,175,255,.22)', color: C.blue}}><Icon name="lock" size={40}/></div>
        <b style={{color: C.text, fontSize: 24, letterSpacing: '-.04em'}}>Sua conversa, do seu jeito.</b>
        <span style={{color: C.muted, fontSize: 14}}>Um tour pelo SeuChatSeguro</span>
      </div>
    </div>
    <div style={{height: 1, background: 'linear-gradient(90deg,transparent,rgba(142,175,255,.45),transparent)'}}/>
    <div style={{paddingTop: 12, display: 'flex', justifyContent: 'space-between', color: '#98a8bd', fontSize: 12}}><span>01 / 08</span><span>Uma demonstração visual</span></div>
  </div>
);

const IntroText: React.FC = () => (
  <div style={{display: 'flex', flexDirection: 'column', gap: 21, maxWidth: 560}}>
    <Brand/>
    <Pill color={C.blue}>APRESENTAÇÃO · SEM ÁUDIO</Pill>
    <h1 style={{...textStyle(76, 700), lineHeight: 1.02}}>SeuChat<span style={{color: C.blue}}>Seguro</span></h1>
    <p style={{...textStyle(33, 500, '#c7d2e1'), maxWidth: 540, lineHeight: 1.38}}>Privacidade, conversas e recursos para o seu dia.</p>
    <div style={{display: 'flex', alignItems: 'center', gap: 12, color: '#95a5ba', fontSize: 15, fontWeight: 500}}><span style={{width: 34, height: 1, background: 'rgba(142,175,255,.7)'}}/> Um tour em menos de um minuto</div>
  </div>
);

const Progress: React.FC<{index: number}> = ({index}) => (
  <div style={{position: 'absolute', left: 76, right: 76, bottom: 29, display: 'flex', gap: 6, zIndex: 5}}>
    {scenes.map((_, i) => <span key={i} style={{height: 3, flex: 1, borderRadius: 99, background: i <= index ? 'rgba(142,175,255,.88)' : 'rgba(255,255,255,.13)'}}/>)}
  </div>
);

const Scene: React.FC<{index: number}> = ({index}) => {
  const frame = useCurrentFrame();
  const scene = scenes[index];
  const local = frame - index * SCENE_STEP;
  const opacity = interpolate(local, [0, 16, SCENE_FRAMES - 20, SCENE_FRAMES], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const rise = interpolate(local, [0, 20], [20, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const subtle = Math.sin(Math.max(local, 0) / 36) * 5;
  const isIntro = scene.kind === 'intro';
  const isOutro = scene.kind === 'outro';
  const accent = scene.kind === 'nodia' ? '83,68,152' : scene.kind === 'daily' ? '100,72,142' : '36,87,214';

  return (
    <AbsoluteFill style={{opacity, transform: `translateY(${rise}px)`}}>
      <Background accent={accent}/>
      {isIntro ? (
        <div style={{position: 'absolute', inset: '0 74px 0 74px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 38}}>
          <IntroText/>
          <div style={{transform: `translateY(${subtle}px)`}}><IntroUI/></div>
        </div>
      ) : isOutro ? (
        <div style={{position: 'absolute', inset: '0 76px 0 76px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 45}}>
          <div style={{maxWidth: 580, display: 'grid', gap: 20}}>
            <Brand/>
            <Pill color={C.green} bg="rgba(142,216,176,.09)">SEU PRÓXIMO PASSO</Pill>
            <h2 style={{...textStyle(62, 700), lineHeight: 1.08}}>A conversa começa com você.</h2>
            <p style={{...textStyle(29, 500, '#c7d2e1'), lineHeight: 1.4}}>Crie sua conta, guarde as palavras de recuperação e conheça o SeuChatSeguro.</p>
            <div style={{display: 'flex', alignItems: 'center', gap: 12, color: '#9eacc0', fontSize: 17}}><Icon name="arrow" size={20} color={C.blue}/> SeuChatSeguro</div>
          </div>
          <div style={{transform: `translateY(${subtle}px)`}}><OutroUI/></div>
        </div>
      ) : (
        <div style={{position: 'absolute', inset: '0 76px 0 76px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 34}}>
          <div style={{width: 540, display: 'flex', flexDirection: 'column', gap: 17}}>
            <Brand compact/>
            <div style={{marginTop: 13, color: C.blue, fontSize: 16, fontWeight: 700, letterSpacing: '.12em'}}>{scene.eyebrow}</div>
            <h2 style={{...textStyle(58, 700), lineHeight: 1.08, maxWidth: 550}}>{scene.title}</h2>
            <p style={{...textStyle(32, 500, '#c1ccda'), lineHeight: 1.42, maxWidth: 535}}>{scene.description}</p>
          </div>
          <div style={{transform: `translateY(${subtle}px) scale(${interpolate(local, [0, 26], [.97, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})})`, transformOrigin: 'center'}}>
            <FeatureUI kind={scene.kind}/>
          </div>
        </div>
      )}
      <div style={{position: 'absolute', top: 29, right: 76, color: '#728198', fontSize: 12, letterSpacing: '.12em', zIndex: 5}}>SEU CHAT · {String(index + 1).padStart(2, '0')} / 08</div>
      <Progress index={index}/>
    </AbsoluteFill>
  );
};

export const SeuChatSeguroTour: React.FC = () => {
  const frame = useCurrentFrame();
  const activeIndex = Math.min(scenes.length - 1, Math.max(0, Math.floor((frame + 12) / SCENE_STEP)));
  return (
    <AbsoluteFill style={{backgroundColor: C.bg, color: C.text, fontFamily: 'Inter, Arial, sans-serif', overflow: 'hidden'}}>
      {scenes.map((_, i) => <Scene key={i} index={i}/>)}
      <div style={{position: 'absolute', right: 78, bottom: 42, zIndex: 10, color: 'rgba(202,213,228,.5)', fontSize: 10, letterSpacing: '.04em'}}>Demonstração visual · alguns recursos dependem de configuração e compatibilidade</div>
      <div style={{position: 'absolute', left: 78, top: 31, zIndex: 10, color: 'rgba(202,213,228,.55)', fontSize: 10, letterSpacing: '.16em'}}>TOUR DO APLICATIVO</div>
      <div style={{position: 'absolute', width: 1, height: 1, left: -10, top: -10, overflow: 'hidden'}}>{activeIndex}</div>
    </AbsoluteFill>
  );
};

const mobileFeatures: Record<SceneKind, Array<[string, string]>> = {
  intro: [['lock', 'Conversas'], ['users', 'Grupos'], ['video', 'Chamadas']],
  account: [['chat', 'Nome e senha'], ['lock', '12 palavras'], ['phone', 'Sem SMS']],
  chat: [['lock', 'Ponta a ponta'], ['chat', 'Mensagens'], ['phone', 'Neste aparelho']],
  groups: [['users', 'Até 20 pessoas'], ['sparkle', 'Cargos'], ['chat', '@menções']],
  calls: [['mic', 'Áudios'], ['video', 'Voz e vídeo'], ['phone', 'Tela']],
  daily: [['sun', 'Clima'], ['chat', 'Notícias'], ['music', 'Música']],
  nodia: [['sparkle', 'Assistente'], ['lock', 'Com consentimento'], ['chat', 'Provedor de IA']],
  outro: [['lock', 'Privacidade'], ['users', 'Grupos'], ['sparkle', 'SeuChatSeguro']],
};

const MobileFeatureStrip: React.FC<{kind: SceneKind}> = ({kind}) => (
  <div style={{...card, width: '100%', minHeight: 92, padding: '13px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, background: 'linear-gradient(110deg,rgba(31,38,49,.95),rgba(21,27,36,.95))'}}>
    {mobileFeatures[kind].map(([icon, label]) => (
      <div key={label} style={{minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: C.muted, fontSize: 18, fontWeight: 600, whiteSpace: 'nowrap'}}>
        <span style={{width: 38, height: 38, display: 'grid', placeItems: 'center', flex: 'none', borderRadius: 13, background: 'rgba(142,175,255,.11)', color: C.blue}}><Icon name={icon} size={20}/></span>
        {label}
      </div>
    ))}
  </div>
);

const MobileScene: React.FC<{index: number}> = ({index}) => {
  const frame = useCurrentFrame();
  const scene = scenes[index];
  const local = frame - index * SCENE_STEP;
  const opacity = interpolate(local, [0, 16, SCENE_FRAMES - 20, SCENE_FRAMES], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const rise = interpolate(local, [0, 20], [18, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const isIntro = scene.kind === 'intro';
  const isOutro = scene.kind === 'outro';
  const accent = scene.kind === 'nodia' ? '83,68,152' : scene.kind === 'daily' ? '100,72,142' : '36,87,214';

  return (
    <AbsoluteFill style={{opacity, transform: `translateY(${rise}px)`}}>
      <Background accent={accent}/>
      <div style={{position: 'absolute', top: 36, left: 72, right: 72, display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
        <Brand compact/>
        <span style={{color: '#8e9bb0', fontSize: 13, letterSpacing: '.1em'}}>TOUR · {String(index + 1).padStart(2, '0')} / 08</span>
      </div>
      <div style={{position: 'absolute', top: 126, left: 62, right: 62, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center'}}>
        <span style={{color: C.blue, fontSize: 19, fontWeight: 750, letterSpacing: '.13em'}}>{scene.eyebrow}</span>
        <h1 style={{...textStyle(isIntro ? 92 : isOutro ? 78 : 74, 700), lineHeight: 1.04, maxWidth: 1140}}>
          {isIntro ? <>Converse com <span style={{color: C.blue}}>mais privacidade.</span></> : scene.title}
        </h1>
        <p style={{...textStyle(54, 500, '#c7d2e1'), lineHeight: 1.32, maxWidth: 1120}}>
          {isIntro ? 'Uma apresentação rápida do SeuChatSeguro.' : isOutro ? 'Crie sua conta e guarde as palavras de recuperação.' : scene.description}
        </p>
      </div>
      <div style={{position: 'absolute', left: 72, right: 72, bottom: 72}}>
        <MobileFeatureStrip kind={scene.kind}/>
      </div>
      <div style={{position: 'absolute', left: 74, right: 74, bottom: 29, display: 'flex', gap: 6, zIndex: 5}}>
        {scenes.map((_, i) => <span key={i} style={{height: 3, flex: 1, borderRadius: 99, background: i <= index ? 'rgba(142,175,255,.88)' : 'rgba(255,255,255,.13)'} }/>)}
      </div>
      <div style={{position: 'absolute', right: 76, bottom: 42, color: 'rgba(202,213,228,.55)', fontSize: 12}}>Demonstração visual · alguns recursos dependem de configuração</div>
    </AbsoluteFill>
  );
};

export const SeuChatSeguroTourMobile: React.FC = () => {
  const frame = useCurrentFrame();
  const activeIndex = Math.min(scenes.length - 1, Math.max(0, Math.floor((frame + 12) / SCENE_STEP)));
  return (
    <AbsoluteFill style={{backgroundColor: C.bg, color: C.text, fontFamily: 'Inter, Arial, sans-serif', overflow: 'hidden'}}>
      {scenes.map((_, i) => <MobileScene key={i} index={i}/>)}
      <div style={{position: 'absolute', width: 1, height: 1, left: -10, top: -10, overflow: 'hidden'}}>{activeIndex}</div>
    </AbsoluteFill>
  );
};
