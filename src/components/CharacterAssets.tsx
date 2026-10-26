import { useIdentityStore } from '../store/useIdentityStore';
import { ROUTE_HASHES } from '../lib/navigation';
import { ThreeViewPanel } from './ThreeViewPanel';
import { Uploader } from './Uploader';

export default function CharacterAssets() {
  const characterName = useIdentityStore((s) => s.characterName);
  const setCharacterName = useIdentityStore((s) => s.setCharacterName);
  return <>
    <div className="character-identity"><label htmlFor="character-name">角色英文名<span>用于影画与海报中的角色署名</span></label><input id="character-name" className="glass-input" value={characterName} onChange={(event) => setCharacterName(event.target.value)} placeholder="CORIN" /></div>
    <div className="character-assets-grid"><Uploader /><ThreeViewPanel /></div>
    <div className="workshop-next"><p>角色准备好了？让它进入画面。</p><a href={ROUTE_HASHES.yinghua} className="studio-action studio-action-primary">开始影画创作 <span aria-hidden="true">↗</span></a></div>
  </>;
}
