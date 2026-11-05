import '../styles/uiverse-loaders.css';
export type LoaderStyle = 'orb'|'wheel'|'coffee';
export default function NodiaLoader({kind}:{kind:LoaderStyle}){return <div className="nodia-loader" aria-hidden="true">{kind==='wheel'? (<div aria-hidden="true" className="uv-wheel-wheel-and-hamster">
	<div className="uv-wheel-wheel"></div>
	<div className="uv-wheel-hamster">
		<div className="uv-wheel-hamster__body">
			<div className="uv-wheel-hamster__head">
				<div className="uv-wheel-hamster__ear"></div>
				<div className="uv-wheel-hamster__eye"></div>
				<div className="uv-wheel-hamster__nose"></div>
			</div>
			<div className="uv-wheel-hamster__limb uv-wheel-hamster__limb--fr"></div>
			<div className="uv-wheel-hamster__limb uv-wheel-hamster__limb--fl"></div>
			<div className="uv-wheel-hamster__limb uv-wheel-hamster__limb--br"></div>
			<div className="uv-wheel-hamster__limb uv-wheel-hamster__limb--bl"></div>
			<div className="uv-wheel-hamster__tail"></div>
		</div>
	</div>
	<div className="uv-wheel-spoke"></div>
</div>) : kind==='coffee'? (<div className="uv-cup-loader">
  <div className="uv-cup-cup">
    <div className="uv-cup-cup-handle"></div>
    <div className="uv-cup-smoke uv-cup-one"></div>
    <div className="uv-cup-smoke uv-cup-two"></div>
    <div className="uv-cup-smoke uv-cup-three"></div>
  </div>
  <div className="uv-cup-load">..........................</div>
</div>
) : (<div className="uv-orb-loader-wrapper">
  <span className="uv-orb-loader-letter">G</span>
  <span className="uv-orb-loader-letter">e</span>
  <span className="uv-orb-loader-letter">n</span>
  <span className="uv-orb-loader-letter">e</span>
  <span className="uv-orb-loader-letter">r</span>
  <span className="uv-orb-loader-letter">a</span>
  <span className="uv-orb-loader-letter">t</span>
  <span className="uv-orb-loader-letter">i</span>
  <span className="uv-orb-loader-letter">n</span>
  <span className="uv-orb-loader-letter">g</span>

  <div className="uv-orb-loader"></div>
</div>
)}</div>}
