import type { Palette, YinghuaStyle } from '../types';

/** Landscape canvas used by the existing generation chain. */
export const YINGHUA_SIZE = '1536x1024';

const join = (...sections: string[]): string => sections.join('\n');

// Identity, references, style and typography each have one owner. Keeping the
// camera/composition section separate prevents prompt cleanup from changing it.
const IDENTITY_ZH = '【角色保真】仅绘制同一角色；保持面部五官、发型发色、固有年龄感、性别、物种、体型、身材比例与身体轮廓，不创造新角色，不增大/缩小部位或拉长/压缩身材。保留机械关节与外壳、兽耳/尾巴/毛发及原有性别体态等身份特征。';
const IDENTITY_EN = '[IDENTITY] Draw exactly the same character. Preserve facial features, hairstyle, hair color, intrinsic age impression, gender, species, physique, body proportions and contours. Never create a new character or enlarge, shrink, elongate or compress body parts. Retain mechanical joints/shells, beast ears/tail/fur and the original gender-specific physique where applicable.';
const OUTPUT_ZH = '【输出】横向宽屏，画幅与裁切范围保持指定要求；只保留单一角色和指定文字，不要参考图缩略图、多视角并排、贴纸、徽标、条码、说明字、小标签、水印或额外背景装饰。';
const OUTPUT_EN = '[OUTPUT] Landscape widescreen; preserve the specified canvas and crop. Keep only one character and the requested typography. No reference thumbnails, side-by-side views, stickers, logos, barcodes, captions, labels, watermarks or extra background decoration.';

export const FIDELITY_PREFIX = join(IDENTITY_ZH, OUTPUT_ZH);
export const FIDELITY_PREFIX_EN = join(IDENTITY_EN, OUTPUT_EN);
export const FIDELITY_EDIT_PREFIX = join(IDENTITY_ZH, OUTPUT_ZH);
export const FIDELITY_EDIT_PREFIX_EN = join(IDENTITY_EN, OUTPUT_EN);

export const ZERO_FATE_COSTUME_LOCK_PREFIX = '【零命衣装锁定·最高优先级】第1张主图（模块02三视图/立绘）是原衣装唯一权威。完整保留服装款式、内外层与部件、领口、袖型、裙/裤长度、护甲、鞋袜、手套、饰品、图案和材质关系；遮挡后重新露出的衣物仍按原设计绘制。禁止增删、替换、合并、简化或重设计衣装；改姿势、镜头、光影或单色渲染只改变表现，不改变衣装设计。';
export const ZERO_FATE_COSTUME_LOCK_PREFIX_EN = '[ZERO-FATE COSTUME LOCK — HIGHEST PRIORITY] Input 1 (the module-02 three-view/primary art) is the sole costume authority. Preserve garment style, every inner/outer layer and component, neckline, sleeves, skirt/trouser length, armor, footwear, hosiery, gloves, accessories, patterns and material relationships. Newly revealed clothing must follow that original design. Never add, remove, replace, merge, simplify or redesign garments; pose, camera, lighting and monochrome rendering change only their presentation.';

/** Anatomy correction must not "solve" foreshortening by changing the camera. */
export const SIX_FATE_ANATOMY_PRIORITY_PREFIX = '【六命结构优先·镜头不变】严格锁定底图视角、机位、透视、裁切、构图、脸位、主体位置、文字位置大小和原动作。保留原有近大远小、透视缩短及前后遮挡，不得靠改变这些镜头与动作参数来规避畸形。两腿各有唯一且连续的髋—大腿—膝—小腿—踝—脚连接；可见轮廓与关节归属清晰，不把被遮挡的腿再画成第三条腿，不把衣褶/袜口误画成关节。保留原裁切和遮挡，画外/遮挡部位不强行补全入画；露肤只揭示原腿结构，不能扩张大腿、增生肉块或改变骨架。肩—肘—腕连续，每手五指；禁止额外/缺失肢体、重复膝盖、融合、穿插、断裂、镜像错位、异常弯折和与原透视不符的局部拉伸。仅修正局部结构和微表情，不重构肢体动作。';
export const SIX_FATE_ANATOMY_PRIORITY_PREFIX_EN = '[SIX-FATE ANATOMY FIRST — SAME CAMERA] Lock the base view, camera position, perspective, crop, composition, face/subject locations, typography placement/size and original action. Preserve its near/far scale, foreshortening and front/back occlusion; never change these viewing/action parameters to avoid defects. Each leg has one continuous hip–thigh–knee–calf–ankle–foot chain with clear visible contours and joint ownership. Never redraw an occluded leg as a third leg or mistake garment folds/hosiery edges for joints. Preserve cropping and occlusion; do not force hidden/off-frame limbs into view. Exposing skin reveals existing leg anatomy, not inflated thighs, extra flesh masses or a new skeleton. Keep continuous shoulder–elbow–wrist connections and five fingers per hand. No extra/missing limbs, duplicate knees, fusion, interpenetration, broken connections, mirrored misplacement, abnormal bending or stretching inconsistent with the original perspective. Correct local anatomy and micro-expression only; never redesign limb actions.';

// These view/pose/crop instructions are retained verbatim from the original
// zero-fate prompt: later tiers must inherit them, never replace them.
const ZERO_COMPOSITION_ZH = '人物构图须有强烈设计感与视觉冲击力——优先采用大仰视、大俯视、极端斜侧等非常规视角，严禁正面平视、证件照式大头、对称站像。角色动作必须是低重心姿态：侧躺、蜷缩、趴卧、瘫坐、倚靠等，身体大面积接触支撑面，避免站立式pose。整体为卸防感的非战斗姿态，放松、慵懒、毫无戒备。同时融入微动态细节——打哈欠、wink、半睁眼、比耶、拉领带、抱玩偶等，制造"时间切片"般的生动瞬间感。允许头顶、肩部、手臂、发尾大幅出框，人物大面积裁切，肢体延展至画面边缘，形成破框而出的开放感。构图偏左或偏右，避免居中；角色主体和文字共占画面约80%~85%；动作设计具有艺术感、展现角色个性特点；画风与第1张主图保持角色设计一致。';
const ZERO_COMPOSITION_EN = 'Composition must have strong design appeal and visual impact — prioritize dramatic low-angle, high-angle, and extreme diagonal perspectives. Strictly forbid front-facing, ID-photo-style headshots, or symmetrical standing poses. The character\'s pose must be a low-center-of-gravity posture: lying on side, curled up, lying prone, slumped sitting, leaning — body making large contact with a support surface. Avoid standing poses. The overall mood is defenseless and non-combat — relaxed, languid, completely unguarded. Incorporate micro-dynamic details: yawning, winking, half-closed eyes, peace sign, pulling a tie, hugging a plushie — creating a vivid frozen-moment feel. Allow head, shoulders, arms, and hair to dramatically break beyond the edges. Crop aggressively with limbs extending to frame borders, creating a sense of breaking out of the image. Offset composition left or right, avoid centering. Character and text together occupy approximately 80%-85% of the frame.';

const EDIT_REFERENCES_ZH = '【编辑参考】第1张为已生成底图，仅锁定姿态、镜头、透视、裁切、构图与文字；第2张为模块02全彩三视图（通常来自模块01），是身份、原始肤色/发色、服装配色/花纹/结构与身体比例的唯一最高权威，不按灰阶底图或记忆猜配色。三视图核对固有形体比例，不把它的站姿、机位或关节二维位置硬套入底图透视。其后的正面结构锚点（若有）只核对结构，禁止照搬它的正面姿势；附加元素（若有）只作武器/道具/装饰参考，不能改变身份和配色。参考可独立输入或作为缩略参考嵌入，最终均不得出现在成图。';
const EDIT_REFERENCES_EN = '[EDIT REFERENCES] Input 1 is the generated base, locking pose, camera, perspective, crop, composition and typography only. Input 2 is the module-02 canonical full-color three-view (usually from module 01), the sole highest authority for identity, original skin/hair colors, garment palette/patterns/structure and body proportions; never guess colors from grayscale or memory. The three-view checks intrinsic proportions; never transplant its standing pose, camera or 2D joint coordinates into the base perspective. Any following front structure anchor checks anatomy only: never copy its frontal pose. Optional addon references are props/weapons/decorations only and must not change identity or palette. References may be separate inputs or embedded reference thumbnails; none may appear in the result.';
const EDIT_LOCK_ZH = '【画面锁定】禁止移动、缩放、旋转、裁切或重新构图。视角、机位、透视、角色轮廓/位置/大小/角度、脸位与表情、文字字形/字距/行距/边距/裁切程度均与零命逐像素对齐。只改色彩、渲染和材质，不照搬三视图的姿势。';
const EDIT_LOCK_EN = '[FRAME LOCK] Never move, scale, rotate, crop or recompose. View, camera, perspective, character contour/position/size/angle, face position/expression and typography letterforms/spacing/line spacing/margins/cropping remain pixel-aligned to zero-fate. Change only color, rendering and material treatment; never copy the three-view pose.';
const LIGHTING_ZH = '【光照】全局45度柔和顶光；光向与布料褶皱、发丝走向共同决定明暗，同一材质按朝向分层，明暗交界清晰但不锐利。';
const LIGHTING_EN = '[LIGHTING] Global soft 45-degree top light. Light direction together with fabric folds and hair flow determines material brightness by orientation; clear but gentle light/shadow boundaries.';

const ZERO_TEXT_ZH = '【文字】超大、水平正置的做旧印刷体「{NAME_TOP}」「{NAME_BOTTOM}」，贴角落边缘；双角配对四选一：左上+左下、右上+右下、左上+右下、右上+左下，不可沿顶边或底边横向并排。基线平行画幅上下边缘，不随人物倾斜，禁止旋转、斜切、弧排或透视变形。「{NAME_TOP}」为最大最宽文字层，宽近左右边缘、高约画面四分之一强，位于角色后方；「{NAME_BOTTOM}」为其50%~60%大小，压于角色前方。必须与角色重叠遮挡，不得缩小或移到空白处回避；前景可遮肩/发/手臂，不挡脸。两层100%不透明实心，颜色分别严格为「{TEXT_TOP}」「{TEXT_BOTTOM}」。';
const ZERO_TEXT_EN = '[TYPOGRAPHY] Oversized horizontal, upright distressed letterpress 「{NAME_TOP}」 and 「{NAME_BOTTOM}」 against corner edges. Choose only top-left+bottom-left, top-right+bottom-right, top-left+bottom-right or top-right+bottom-left; never pair side-by-side along the top/bottom edge. Baselines stay parallel to frame edges regardless of the reclining character; no rotation, skew, arc or perspective deformation. 「{NAME_TOP}」 is the largest/widest layer, spanning near both side edges and slightly over a quarter of frame height, BEHIND the character. 「{NAME_BOTTOM}」 is 50%-60% of its size, IN FRONT. Both must overlap/occlude the character, never shrink or move to empty space to avoid overlap. Foreground may cover shoulders/hair/arms, not the face. Both are solid, 100% opaque; exact colors respectively 「{TEXT_TOP}」 and 「{TEXT_BOTTOM}」.';
const THREE_TEXT_ZH = '【文字】仅「{NAME_TOP}」「{NAME_BOTTOM}」，位置、大小、字形与零命完全一致；两层均严格用「{TEXT_BOTTOM}」高饱和实心字体，100%不透明，禁止去饱和或透出后方角色。';
const THREE_TEXT_EN = '[TYPOGRAPHY] Only 「{NAME_TOP}」 and 「{NAME_BOTTOM}」. Preserve zero-fate placement, size and letterforms. Both must be 「{TEXT_BOTTOM}」, highly saturated, solid and 100% opaque; never desaturate or reveal the character through them.';
const SIX_TEXT_ZH = '【文字】仅「{NAME_TOP}」「{NAME_BOTTOM}」，位置、大小、字形和前后层级沿用底图；分别严格使用「{TEXT_TOP_BRIGHT}」「{TEXT_BOTTOM}」，100%不透明实心。直接叠加在完整画面之上，文字背后的角色和背景仍完整渲染，不挖空、不留白、不填纯色块。';
const SIX_TEXT_EN = '[TYPOGRAPHY] Only 「{NAME_TOP}」 and 「{NAME_BOTTOM}」. Retain base placement, size, letterforms and front/back ordering; exact colors respectively 「{TEXT_TOP_BRIGHT}」 and 「{TEXT_BOTTOM}」, solid and 100% opaque. Overlay on fully rendered character/background content; never cut out, blank or flat-fill the regions behind text.';

const SIX_COLOR_ZH = '【六命配色铁律】肤色、发色、服装、花纹和配饰100%匹配第2张全彩三视图，原色优先于光照与风格化，不统一染色或另换配色。尤其不得把灰阶误认成白/银/浅灰/漂白发；三视图没有这种发色就不生成。';
const SIX_COLOR_EN = '[SIX-FATE COLOR IRON RULE] Skin, hair, garments, patterns and accessories must match input 2\'s original full-color palette 100%; original colors take priority over lighting and stylization. Never recolor uniformly or replace the palette. Never mistake grayscale for white/silver/light-gray/bleached hair unless the canonical three-view actually has that hair color.';
const SIX_FINISH_ZH = join(
  '【画面与质感】纯白背景#FFFFFF，无渐变、噪点、纹理、背景阴影或暗角。全彩高饱和赛璐珞，脸部清晰，高精度明亮印刷品美学；放松、慵懒的非战斗日常氛围，不改变底图动作。',
  LIGHTING_ZH,
  '皮肤/机体表面细腻光滑，明亮高光反射与自然明暗过渡。角色动态：{ACTION_POSE}，仅用于理解底图动作，不据此另换姿势。{CHARACTER_TRAITS}',
  '{SIX_TEXT}',
);
const SIX_FINISH_EN = join(
  '[FINISH] Pure white #FFFFFF background; no gradient, noise, texture, background shadow or vignette. High-saturation full-color cel-shading, clear face, high-precision bright print aesthetic and relaxed, languid non-combat daily mood; preserve the base action.',
  LIGHTING_EN,
  'Smooth refined skin/body surfaces, bright specular highlights and natural shading transitions. Character dynamic: {ACTION_POSE}; interpret the base action, never replace its pose. {CHARACTER_TRAITS}',
  '{SIX_TEXT}',
);

const SIX_FRONT_ZH = join(
  '《绝区零》Mindscape Cinema六命阳影画风格，明亮健康、全年龄游戏美术。',
  EDIT_REFERENCES_ZH,
  '【阳面任务】第1张为三命成图，在原视角、机位、透视和动作下，仅将灰阶还原为全彩高饱和赛璐珞；服装款式、配件与花纹不改，沿用三视图真实颜色。',
  SIX_COLOR_ZH,
  SIX_FINISH_ZH,
);
const SIX_FRONT_EN = join(
  'ZZZ Mindscape Cinema six-fate Yang art style; bright, wholesome, all-ages game artwork.',
  EDIT_REFERENCES_EN,
  '[YANG TASK] Input 1 is the three-fate result. Preserve its view, camera, perspective and action while restoring grayscale to high-saturation full-color cel-shading. Do not change garment design, accessories or patterns; restore canonical original colors.',
  SIX_COLOR_EN,
  SIX_FINISH_EN,
);
const STREAMLINE_ZH = '【服装精简·必须执行】只在原服装上做减法，不换款、不设计整套新衣。按实际结构选择，不必凑数：外套/披风/斗篷/大衣/外甲去除或显著改短/改薄/镂空；防护板/机械外壳去除非关键覆盖或镂空但保留机体结构；裙/衣下摆显著改短或高开衩；袖部改无袖/短袖/吊带/挂脖；领部调整为深V/方领/挂脖/露肩；背部露背/绑带/镂空；腰封/腹部覆盖去除或腰侧镂空/露脐；裤装/裙内层改短或去除冗余覆盖。呈现自然松动、滑落或改短，不是暴力破坏；保留原色、图案与标志性装饰。肩、锁骨、胸线、腰腹、后背、大腿、手臂等适用区域连续呈现，露肤面积明显增加。腿部仍保持原袜装（如有），不添加三视图不存在的深色丝袜/连裤袜；只改变衣物覆盖，不改变身体比例、关节、腿部轮廓和遮挡。';
const STREAMLINE_EN = '[COSTUME STREAMLINING — REQUIRED] Subtract from existing garments only; never replace the outfit style or invent a new set. Apply where relevant without a quota: remove or significantly shorten/thin/open outerwear/capes/cloaks/coats/outer armor; open or remove non-critical protective plates/shell coverage while preserving mechanical structure; shorten skirt/hems or add high slits; use sleeveless/short-sleeve/tank/halter variants; adjust neckline to deep-V/square/halter/off-shoulder; open-back/straps/cutouts; remove waist/abdominal coverage or add waist-side/bare-midriff cutouts; shorten lower garments/inner skirts or remove redundant coverage. Garments loosen, slip or shorten naturally, never look violently destroyed. Preserve original colors, patterns and signature decoration. Relevant shoulder/collarbone/chest line/waist/back/thigh/arm regions show continuous skin with noticeably increased exposure. Preserve existing legwear; never add dark stockings/tights absent from the three-view. Change coverage only, never body proportions, joints, leg contours or occlusion.';
const SIX_BACK_ZH = join(
  '《绝区零》Mindscape Cinema六命阴影画风格，明亮健康、全年龄日常休闲氛围。',
  EDIT_REFERENCES_ZH,
  '【阴面任务】第1张为已完成的六命阳全彩成图，仅精简原服装；它的视角、机位、透视、裁切、构图、脸位、身位、原动作和文字保持不变，不重新安排四肢。',
  SIX_COLOR_ZH,
  STREAMLINE_ZH,
  SIX_FINISH_ZH,
);
const SIX_BACK_EN = join(
  'ZZZ Mindscape Cinema six-fate Yin art style; bright, wholesome, all-ages relaxed daily atmosphere.',
  EDIT_REFERENCES_EN,
  '[YIN TASK] Input 1 is the completed full-color six-fate Yang result. Streamline the original costume only; preserve its view, camera, perspective, crop, composition, face/subject locations, original action and typography. Never rearrange limbs.',
  SIX_COLOR_EN,
  STREAMLINE_EN,
  SIX_FINISH_EN,
);

/** Retained for callers of the dedicated clothing-only second pass. */
export const YINGHUA_UNDRESS_PASS = SIX_BACK_ZH;
export const YINGHUA_UNDRESS_PASS_EN = SIX_BACK_EN;

// Unrelated three-view prompts stay unchanged.
export const THREE_VIEW_PROMPT = `根据角色图片特点补全三视图，生成图中角色三视图并且整合到一张图中，所有视图必须与上传图片中的角色严格一致——面部、发型发色、服装与配色完全统一无改动，结构准确，无任何遮挡，统一光影，统一画风，纯白色干净背景，无多余杂物、无水印文字，细节拉满，高精度，不要文字，不要背景。同时生成角色面部特写放在图右侧。`;
export const COSTUME_CHANGE_PROMPT = `请将角色身上的服装修改为[青春感白丝JK装]，不改变装饰和整体人物风格，按照原图生成三视图，细节拉满，高精度，不要文字，不要背景，生成角色面部特写放在图右。`;

export function splitName(name: string): [string, string] {
  const parts = name.trim().split(/\s+/);
  return parts.length === 1 ? [parts[0], parts[0]] : [parts[0], parts.slice(1).join(' ')];
}

export const YINGHUA_STYLES: YinghuaStyle[] = [
  {
    id: 1,
    label: '零命 · 单色调深色剪影',
    description: '单色调深色剪影海报风，主体压深、内部用亮线勾勒透出细节，压在明亮同色背景上高对比。',
    promptTemplate: join(
      '《绝区零》Mindscape Cinema单色调深色剪影海报风。第1张主图锁定身份与衣装；可选附加元素只作道具参考；其余3张风格样张只参考构图方向、人物风格、色彩关系和角落文字，不借用角色、衣装、道具、名字或背景配色。',
      ZERO_COMPOSITION_ZH,
      '{ZERO_TEXT}',
      '【角色明暗与配色】主体统一为「{DOMINANT_COLOR}」单一色相的低饱和灰调，暗部占绝大部分，接近深色剪影。全部裸露皮肤为最暗近纯黑，五官极隐约；头发、衣装、护甲和配饰也以深暗为主，仅受光面、结构线和褶皱高光提亮，不大面积铺亮色/白色，不把皮肤画亮。通过明度差保留材质和原衣装/花纹细节。双色调主色为低饱和「{DOMINANT_COLOR}」；仅虹膜和极少数标志配饰保留主图原色，不换主题色、不额外提亮，除此无其他色相。',
      LIGHTING_ZH,
      '【背景】「{DOMINANT_COLOR}」的高饱和高亮版纯色平涂，非低饱和灰调；深沉主体与鲜亮背景形成撞色、明暗和饱和度双重对比。主体背景明确分离，仅允许极少量染边，不让主体大块面融进背景。保持强烈留白、斜向冲击和登场张力；不要求全身入画。',
      '角色动态：{ACTION_POSE}。{CHARACTER_TRAITS}',
    ),
    promptTemplateEn: join(
      'ZZZ Mindscape Cinema Monochrome Dark Silhouette Poster. Input 1 locks identity/costume; optional addon is prop reference only; the final three style samples supply composition, character treatment, color relationships and corner typography only. Never borrow their characters, garments, props, names or background palettes.',
      ZERO_COMPOSITION_EN,
      '{ZERO_TEXT}',
      '[CHARACTER VALUES/COLORS] Unify the subject to a muted/desaturated 「{DOMINANT_COLOR}」 hue with deep shadows over most of its area, nearly a dark silhouette. All bare skin is darkest near-black with barely visible facial features. Hair, clothing, armor and accessories are predominantly dark too: lift only lit surfaces, structural lines and fold highlights; no large bright/white fills and no bright skin. Distinguish materials and preserve original garments/patterns with value differences. Duotone dominant is muted 「{DOMINANT_COLOR}」; only irises and very few signature accessories retain input 1\'s original colors, never theme-recolored or artificially brightened. No other hues.',
      LIGHTING_EN,
      '[BACKGROUND] Flat vivid, high-saturation/high-brightness 「{DOMINANT_COLOR}」, not muted grayscale. Strong light/dark and saturation contrast against the deep muted subject. Clearly separate subject/background, allowing only tiny edge bleeding; never merge large subject masses into the background. Strong negative space, diagonal impact and entrance tension; full-body framing is not required.',
      'Character dynamic: {ACTION_POSE}. {CHARACTER_TRAITS}',
    ),
  },
  {
    id: 2,
    label: '三命 · 暗色背景 / 亮色主角',
    description: '深黑背景，极端去饱和灰度主调 + 高饱和点缀色，严格对齐零命构图。',
    promptTemplate: join(
      '《绝区零》Mindscape Cinema三命：编辑零命，冷酷锐利的中性灰阶主体+高饱和点缀，画风与零命一致。',
      EDIT_REFERENCES_ZH,
      EDIT_LOCK_ZH,
      '【衣装与肤色判读】衣装/花纹/配饰结构严格按三视图保留，只改色彩；不添加口罩、面罩、眼镜、绷带、纹身、伤痕等原图不存在的元素。零命裸腿裸臂也会渲染成黑色，不能据此当成黑丝/深色织物；只有三视图明确有袜装才保留，否则还原为符合原肤色的灰阶裸露肌肤。',
      '【灰阶】除指定点缀，主体彻底去饱和为R=G=B的纯中性黑白灰，去除零命「{DOMINANT_COLOR}」偏色，无残余染色灰。按三视图原亮暗关系转换：亮部浅灰至近白230–255，暗部深灰至近黑10–30；不是均匀死灰。皮肤按三视图原肤色形成对应浅/中/深灰，不能照搬零命近黑脸/肌肤。强块面光影、清晰外轮廓线稿表现立体层次、褶皱和发丝。',
      LIGHTING_ZH,
      '【点缀】仅极少数披风、指甲、手套、唇舌、标志配饰/发饰/道具挂饰/领结纹饰等指定部位，强制恢复三视图对应原色，100%满饱和并额外提亮30%；不可沿用零命灰调。形成鲜艳点缀与灰阶主体的最强焦点反差，其他部位无其他颜色。',
      '【背景】统一深黑RGB 8–15，可有极微弱工业噪点，不要具体场景、第二色、渐变或暗角；主体与背景极强明暗对比，轮廓清晰锐利、高光近白。{CHARACTER_TRAITS}',
      '{THREE_TEXT}',
    ),
    promptTemplateEn: join(
      'ZZZ Mindscape Cinema three-fate: edit zero-fate into a cool, sharp neutral grayscale subject with intensely saturated accents. Keep the same art style.',
      EDIT_REFERENCES_EN,
      EDIT_LOCK_EN,
      '[GARMENTS/SKIN] Preserve canonical garment/pattern/accessory structures; change color only. Never add masks, glasses, bandages, tattoos, scars or other nonexistent elements. Bare arms/legs also look black in zero-fate: never infer dark stockings/fabric from that silhouette. Keep legwear only when the three-view explicitly has it; otherwise render bare skin in grayscale derived from its original skin tone.',
      '[GRAYSCALE] Except for designated accents, fully desaturate to true neutral R=G=B black/white/gray. Strip zero-fate\'s 「{DOMINANT_COLOR}」 tint completely, with no tinted-gray residue. Convert canonical original value relationships: bright areas to light-gray/near-white 230–255, dark areas to dark-gray/near-black 10–30, not uniform flat gray. Skin uses light/mid/dark gray according to canonical skin tone; do not copy zero-fate\'s near-black face/skin. Strong blocky shading and crisp contour linework convey volume, folds and hair.',
      LIGHTING_EN,
      '[ACCENTS] Only very few designated cape/nail/glove/lip/signature accessory/hair ornament/prop pendant/bow-pattern areas restore corresponding original three-view colors at 100% saturation plus 10% brightness, never zero-fate\'s gray tones. Maximal vivid-accent versus grayscale focal contrast; no other subject colors.',
      '[BACKGROUND] Uniform deep-black RGB 8–15 with optional extremely faint industrial noise; no scene, second color, gradient or vignette. Extreme value contrast, crisp silhouette, near-white highlights. {CHARACTER_TRAITS}',
      '{THREE_TEXT}',
    ),
  },
  {
    id: 3,
    label: '六命 · 全彩 / 肤色高光',
    description: '全彩高饱和赛璐珞；阳还原原色，阴精简衣装。保留底图镜头、透视与动作，只修正局部结构。',
    promptTemplate: SIX_FRONT_ZH,
    promptTemplateEn: SIX_FRONT_EN,
    promptTemplateFront: SIX_FRONT_ZH,
    promptTemplateFrontEn: SIX_FRONT_EN,
    promptTemplateBack: SIX_BACK_ZH,
    promptTemplateBackEn: SIX_BACK_EN,
  },
];

export function fillName(
  template: string,
  name: string,
  palette?: Palette,
  showText?: boolean,
  characterDynamic?: string,
  microDynamic?: string,
  characterTraits?: string,
  lang?: 'zh' | 'en',
  styleId?: number,
): string {
  const english = lang === 'en';
  const upper = (name || 'CHARACTER').toUpperCase();
  const [top, bottom] = splitName(upper);
  const noText = english
    ? '[TYPOGRAPHY OFF] No text, lettering, name, watermark or label; preserve the remaining composition and fully render the character/background where base text used to be.'
    : '【文字关闭】不绘制任何文字、字母、名字、水印或标签；其余构图不变，底图原文字区域恢复完整角色/背景。';

  // Expand the one typography section before substituting names/colors. Turning
  // text off removes its positive instructions rather than appending a conflict.
  let filled = template
    .replaceAll('{ZERO_TEXT}', showText === false ? noText : english ? ZERO_TEXT_EN : ZERO_TEXT_ZH)
    .replaceAll('{THREE_TEXT}', showText === false ? noText : english ? THREE_TEXT_EN : THREE_TEXT_ZH)
    .replaceAll('{SIX_TEXT}', showText === false ? noText : english ? SIX_TEXT_EN : SIX_TEXT_ZH)
    .replaceAll('{ACTION_POSE}', [characterDynamic, microDynamic].filter(Boolean).join('；') || '卸防感的非战斗姿态，放松慵懒毫无戒备')
    .replaceAll('{CHARACTER_TRAITS}', characterTraits
      ? (english ? `Character personality traits: ${characterTraits}.` : `角色性格特点：${characterTraits}。`)
      : '')
    .replaceAll('{NAME_TOP}', top)
    .replaceAll('{NAME_BOTTOM}', bottom)
    .replaceAll('{NAME}', upper)
    .replaceAll('{DOMINANT_COLOR}', palette?.dominant ?? '#b026ff')
    .replaceAll('{ACCENT_COLOR}', palette?.accent ?? '#ff2d9b')
    .replaceAll('{TEXT_TOP}', palette?.textTop ?? '#1a1a2e')
    .replaceAll('{TEXT_BOTTOM}', palette?.textBottom ?? '#cc66ff')
    .replaceAll('{TEXT_TOP_BRIGHT}', palette?.textTopBright ?? '#e099ff');

  // Other modules still use fillName with their own templates; preserve their
  // existing text-toggle handling instead of interpreting unknown prose.
  if (showText === false && !/\{(?:ZERO|THREE|SIX)_TEXT\}/.test(template)) {
    filled = filled.replace(/做旧印刷体「[^」]+」和「[^」]+」分别放置于两个角落[^']*/, '画面整洁不含任何文字，无水印');
  }
  const fidelity = styleId === 2 || styleId === 3
    ? (english ? FIDELITY_EDIT_PREFIX_EN : FIDELITY_EDIT_PREFIX)
    : (english ? FIDELITY_PREFIX_EN : FIDELITY_PREFIX);
  const priority = styleId === 1
    ? (english ? ZERO_FATE_COSTUME_LOCK_PREFIX_EN : ZERO_FATE_COSTUME_LOCK_PREFIX)
    : styleId === 3
      ? (english ? SIX_FATE_ANATOMY_PRIORITY_PREFIX_EN : SIX_FATE_ANATOMY_PRIORITY_PREFIX)
      : '';
  return join(...[priority, fidelity, filled].filter(Boolean));
}
