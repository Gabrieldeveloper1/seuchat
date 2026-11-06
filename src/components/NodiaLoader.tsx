import "../styles/uiverse-loaders.css";

export default function NodiaLoader() {
  return (
    <div className="nodia-loader" aria-hidden="true">
      <div className="uv-cup-loader">
        <div className="uv-cup-cup">
          <div className="uv-cup-cup-handle" />
          <div className="uv-cup-smoke uv-cup-one" />
          <div className="uv-cup-smoke uv-cup-two" />
          <div className="uv-cup-smoke uv-cup-three" />
        </div>
        <div className="uv-cup-load">..........................</div>
      </div>
    </div>
  );
}