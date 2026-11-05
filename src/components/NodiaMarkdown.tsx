import {isValidElement, useState, type ReactNode} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {IconCopy} from '../icons';

function textOf(children:ReactNode):string {
 if(typeof children==='string'||typeof children==='number')return String(children);
 if(Array.isArray(children))return children.map(textOf).join('');
 if(isValidElement<{children?:ReactNode}>(children))return textOf(children.props.children);
 return '';
}
function CopyButton({text,label}:{text:string;label:string}){
 const [status,setStatus]=useState('');
 return <button type="button" className="nodia-copy" aria-label={label} onClick={async()=>{try{await navigator.clipboard.writeText(text);setStatus('Copiado')}catch{setStatus('Não foi possível copiar')}window.setTimeout(()=>setStatus(''),2200)}}><IconCopy aria-hidden="true"/><span>{status||label}</span></button>;
}
export default function NodiaMarkdown({content,streaming=false}:{content:string;streaming?:boolean}){
 return <div className="nodia-answer"><div className="nodia-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
   a:({children,href})=><a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
   img:({alt})=><span>{alt?`[Imagem: ${alt}]`:'[Imagem omitida]'}</span>,
   pre:({children})=><div className="nodia-code"><div className="nodia-code-bar"><span>CÓDIGO</span><CopyButton text={textOf(children).replace(/\n$/,'')} label="Copiar código"/></div><pre>{children}</pre></div>,
   table:({children})=><div className="nodia-table-wrap"><table>{children}</table></div>,
 }}>{content}</ReactMarkdown>{streaming&&<span className="nodia-caret" aria-hidden="true"/>}</div>{!streaming&&<div className="nodia-copy-row"><CopyButton text={content} label="Copiar resposta"/></div>}</div>;
}
