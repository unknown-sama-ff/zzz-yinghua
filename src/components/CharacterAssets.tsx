import { useIdentityStore } from '../store/useIdentityStore';
import { ROUTE_HASHES } from '../lib/navigation';
import { ThreeViewPanel } from './ThreeViewPanel';
import { Uploader } from './Uploader';
import { CharacterBreakdownPanel } from './CharacterBreakdownPanel';

export default function CharacterAssets() {
  const characterName = useIdentityStore((s) => s.characterName);
  const setCharacterName = useIdentityStore((s) => s.setCharacterName);
  return <>
    <div className="character-identity"><label htmlFor="character-name">角色名字（必填）<span>生成三视图前填写，也用于拆解图设定与影画署名</span></label><input id="character-name" required className="glass-input" value={characterName} onChange={(event) => setCharacterName(event.target.value)} placeholder="例如：CORIN / 可琳" /></div>
    <div className="character-assets-grid"><Uploader /><ThreeViewPanel /></div>
    <CharacterBreakdownPanel />
    <div className="workshop-next"><p>角色准备好了？让它进入画面。</p><a href={ROUTE_HASHES.yinghua} className="studio-action studio-action-primary">开始影画创作 <span aria-hidden="true">↗</span></a></div>
  </>;
}
