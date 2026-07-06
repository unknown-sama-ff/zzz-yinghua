import type { Palette, YinghuaStyle } from '../types';

/**
 * Landscape output size for yinghua art. 1536x1024 = 3:2 ratio.
 */
export const YINGHUA_SIZE = '1536x1024';

/**
 * Fidelity prefix — prepended to every yinghua style prompt so the model treats
 * the uploaded art as the character reference and keeps identity intact while
 * stylizing. Surfaced (and editable) in the UI as part of each prompt.
 */
export const FIDELITY_PREFIX =
  '严格参考并保留上传图片中角色的面部特征、发型发色、服装细节与配色，确保为同一角色、不改变身份特征；主角色图与原始立绘是唯一角色身份参考，生成的必须是上传图片中的角色本人，严禁自行设计或创造新角色，所有面部特征、五官比例、发型发色、体型、服装细节必须与三视图的角色完全一致；如果参考图中包含额外道具/武器/装饰元素，仅将其作为可加入角色动作设计的附加元素参考；不得改变角色身份、发型、面部和主体服饰风格；画面必须为横向构图（landscape，宽大于高，3:2 横幅），不需要展示角色全身，突出角色特点与个性，但角色下胸部以上必须完整呈现于画面中；零命为暗色剪影风格，三命与六命为零命的色彩变换版本——三者的画风分别由下方风格化指令独立决定；最终画面只保留角色主体与正常比例英文名字文字，不要任何额外贴纸、徽标、条码、说明字、小标签或背景装饰。在此前提下进行如下风格化：';

/**
 * Three-view + close-up generation prompt.
 */
export const THREE_VIEW_PROMPT = `根据角色图片特点补全三视图，生成图中角色三视图并且整合到一张图中，所有视图必须与上传图片中的角色严格一致——面部、发型发色、服装与配色完全统一无改动，结构准确，无任何遮挡，统一光影，统一画风，纯白色干净背景，无多余杂物、无水印文字，细节拉满，高精度，不要文字，不要背景。同时生成角色面部特写放在图右侧。`;

/**
 * Costume-change three-view prompt.
 */
export const COSTUME_CHANGE_PROMPT = `请将角色身上的服装修改为[青春感白丝JK装]，不改变装饰和整体人物风格，按照原图生成三视图，细节拉满，高精度，不要文字，不要背景，生成角色面部特写放在图右。`;

/**
 * Split a character name into top/bottom halves for the yinghua layout.
 * "XING YUN" → ["XING", "YUN"]; single word → same word for both.
 */
export function splitName(name: string): [string, string] {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return [parts[0], parts[0]];
  return [parts[0], parts.slice(1).join(' ')];
}

/**
 * Text instruction: English character names in normal proportions, placed as
 * corner typography rather than stretched bands across the image.
 */
export const TEXT_INSTRUCTION =
  '做旧印刷体英文「{NAME_TOP}」和「{NAME_BOTTOM}」分别放置于两个角落，形成对角或同侧配对（左上+左下 或 左上+右下 或 右上+左下 或 右上+右下 四选一），文字必须贴近所在角落的边缘位置，采用超大号字体，文字允许与角色局部叠压但不得遮挡脸部主体，文字不透明度100%、完全实心，不可透过文字看到后方角色';

/**
 * The three ZZZ yinghua art styles.
 */
export const YINGHUA_STYLES: YinghuaStyle[] = [
  {
    id: 1,
    label: '零命 · 暗调角色 / 亮色背景',
    description: '高对比暗色剪影，保留内部层次与服装细节，接近官方影画印刷感。',
    promptTemplate:
      '参考图包含原始角色立绘与风格样张：原始角色立绘用于身份、面部、发型、服饰与配色参考；样张仅用于绝区零影画的整体构图方向、色彩关系与角落文字排版参考，严禁借用样张中的人物外形和名字。绝区零官方Mindscape Cinema影画风格，暗色剪影印刷美学（Dark Silhouette Print Style）：基于原始角色立绘生成基准图{CHARACTER_TRAITS}；人物构图须有强烈设计感与视觉冲击力——优先采用大仰视、大俯视、极端斜侧等非常规视角，严禁正面平视、证件照式大头、对称站像。角色动作必须是低重心姿态：侧躺、蜷缩、趴卧、瘫坐、倚靠等，身体大面积接触支撑面，避免站立式pose。整体为卸防感的非战斗姿态，放松、慵懒、毫无戒备。同时融入微动态细节——打哈欠、wink、半睁眼、比耶、拉领带、抱玩偶等，制造"时间切片"般的生动瞬间感。允许头顶、肩部、手臂、发尾大幅出框，人物大面积裁切，肢体延展至画面边缘，形成破框而出的开放感。构图偏左或偏右，避免居中；角色主体和文字共占约占画面80%~85%；动作设计具有艺术感、展现角色个性特点；画风与原三视图保持完全一致。文字排版为画面强制核心要素：采用超大号且必须水平排版的做旧印刷体英文{NAME_TOP}和{NAME_BOTTOM}，以双角配对方式放置，文字必须贴近所在角落的边缘位置，严禁旋转、斜切、弧排或透视变形；{NAME_TOP}文字组为三者中最大最宽的文字层，宽度接近画面左右边缘，高度约达画面的四分之一强；{NAME_BOTTOM}文字组明显小于{NAME_TOP}，约为{NAME_TOP}的五到六成大小；{NAME_TOP}位于角色后方作为背景层，{NAME_BOTTOM}压于角色前方作为前景层；文字必须与角色产生重叠和前后遮挡关系，严禁将文字缩到空白角落或边缘空旷处；文字可压住肩、发、手臂等局部，但不得遮挡脸部主体；{NAME_TOP}文字颜色强制使用{TEXT_TOP}，{NAME_BOTTOM}文字颜色强制使用{TEXT_BOTTOM}，不得使用其他颜色；文字不透明度100%、完全实心，不可透过文字看到后方角色。角色主体以接近纯黑的深黑块面为主（不是背景色），形成平面压印效果；光照采用45度柔和顶光作为全局光源，全图所有元素均受此光源影响；服装与头发的亮暗由光照方向与布料褶皱、发丝走向共同决定，同一材质因褶皱朝向不同呈现不同明暗，形成自然光影层次；明暗交界清晰但不锐利。角色肌肤强制排除在光源影响之外——肌肤始终保持深黑近黑色调，不受45度顶光提亮影响。角色内部色彩控制：脸部与身体肤色不能是纯黑，应为深黑色上盖了一层主题色滤镜的效果，在黑色基底上叠加约5%~8%的{DOMINANT_COLOR}或{ACCENT_COLOR}作为肤色罩染，使肌肤透出微弱的主题色倾向，严禁脸部发亮；毛发、服饰、挂饰、配件、发饰等所有非皮肤部位统一使用主色调{DOMINANT_COLOR}的较暗色阶变体（亮度降低20%-40%），保持同一色相，不得出现{DOMINANT_COLOR}和{ACCENT_COLOR}以外的其他颜色；毛发与服饰不可与背景亮度相同，必须比背景色暗约两个等级；角色肌肤亮度不能高于服装和毛发，即肌肤必须是全身最暗的部分，颜色亮度可上下浮动30%来表达层次感；主体与背景必须明确分离，只允许极少量边缘被背景色轻微染边，大面积块面绝不能变成背景色本身。服装本体、花纹、布料印花、袖口纹样、腰带图案不得做任何改动，必须与原三视图完全一致，严禁自行修改、增减、简化或重新设计任何服装部件，仅可改变其色彩亮暗以符合深暗色域要求；花纹仅以低对比度暗纹或压印感存在，不得形成可读亮花纹。高光只限极细外轮廓描线和少量发丝边缘，眼睛不得出现任何高光或发光点。背景使用高饱和亮色纯色平涂，优先使用{DOMINANT_COLOR}或{ACCENT_COLOR}作为大面积底色。角色动态：{ACTION_POSE}；整体效果：高对比、强设计感、深黑压印主体、主题色背景、水平超大角落压版文字、强烈留白与斜向冲击感，呈现出角色华丽登场的登场感。',
      promptTemplateEn: 'Strictly reference and preserve the uploaded image\'s facial features, hairstyle and color, clothing details and palette — ensure it is the same character without altering their identity. Reference images include the original character art and style samples: the original character art is used for identity, face, hairstyle, clothing and color reference; style samples are ONLY used for composition direction, color relationship and corner typography reference of ZZZ yinghua art — do NOT borrow the character design or name from the samples. ZZZ Official Mindscape Cinema art style, Dark Silhouette Print Aesthetic: generate the base image from the original character art {CHARACTER_TRAITS}. Composition must have strong design appeal and visual impact — prioritize dramatic low-angle, high-angle, and extreme diagonal perspectives. Strictly forbid front-facing, ID-photo-style headshots, or symmetrical standing poses. The character\'s pose must be a low-center-of-gravity posture: lying on side, curled up, lying prone, slumped sitting, leaning — body making large contact with a support surface. Avoid standing poses. The overall mood is defenseless and non-combat — relaxed, languid, completely unguarded. Incorporate micro-dynamic details: yawning, winking, half-closed eyes, peace sign, pulling a tie, hugging a plushie — creating a vivid frozen-moment feel. Allow head, shoulders, arms, and hair to dramatically break beyond the edges. Crop aggressively with limbs extending to frame borders, creating a sense of breaking out of the image. Offset composition left or right, avoid centering. Character and text together occupy approximately 80%-85% of the frame. Text layout is a MANDATORY core element: use oversized, horizontally-aligned distressed letterpress English text {NAME_TOP} and {NAME_BOTTOM}, placed in a two-corner pair configuration. Text MUST cling close to its corner edge. Strictly forbid rotation, skew, arc, or perspective deformation. {NAME_TOP} is the largest and widest text layer, spanning close to the left and right edges, roughly one-quarter of the frame height. {NAME_BOTTOM} is noticeably smaller, approximately 50%-60% the size of {NAME_TOP}. {NAME_TOP} sits BEHIND the character as the background layer; {NAME_BOTTOM} sits IN FRONT as the foreground layer. Text MUST overlap and occlude the character — forbidden to shrink text into empty corners or edges. Text may press onto shoulders, hair, arms but must not obscure the face. {NAME_TOP} color: {TEXT_TOP}. {NAME_BOTTOM} color: {TEXT_BOTTOM}. Neither may use any other color. Text opacity 100%, completely solid — the character behind must not be visible through the text. The character figure should be primarily near-pure-black dark blocks (NOT the background color), forming a planar imprint effect. Lighting uses a soft 45-degree top light as the global light source affecting all elements. The brightness of clothing and hair is determined jointly by light direction AND natural folds, creases, and hair flow — the same material may show different brightness depending on how its folds face the light, creating natural light-shadow modeling. Light-shadow boundary is clear but gentle. Character skin is FORCEFULLY EXCLUDED from the light source — skin must remain deep dark near-black tones and must NOT be brightened by the 45-degree top light. Internal color control: face and body skin must NOT be pure black — it should be deep black overlaid with a theme-color filter effect, with approximately 5%-8% {DOMINANT_COLOR} or {ACCENT_COLOR} as a skin glaze, revealing a faint theme-color cast. Strictly forbid face brightening. Hair, clothing, accessories, ornaments, hairpieces — all non-skin areas — must uniformly use darker shade variants of the dominant color {DOMINANT_COLOR} (brightness reduced by 20%-40%), staying within the same hue. No colors other than {DOMINANT_COLOR} and {ACCENT_COLOR} are allowed. The bright colors of hair and clothing must NOT match the background brightness — they must be approximately two levels darker than the background color; the skin must be the darkest element on the entire figure — its brightness must not exceed that of clothing or hair. Color brightness may vary 30% to express depth. Subject must clearly separate from the background. Clothing body, patterns, fabric prints, cuff designs, waistband patterns must not be altered in any way — must match the original character art exactly. Strictly forbid modifying, adding, removing, simplifying or redesigning any clothing parts. Only brightness/darkness may be adjusted to fit the deep-dark range. Patterns may only exist as low-contrast dark motifs or imprint textures — no readable bright patterns. Highlights are limited to extremely fine outer contour lines and a few hair edges. Eyes must have NO highlights or glowing points whatsoever. Background: high-saturation flat bright color, prioritizing {DOMINANT_COLOR} or {ACCENT_COLOR}. Character dynamic: {ACTION_POSE}. Overall effect: high contrast, strong design sense, deep-black imprinted figure, theme-color background, horizontal oversized corner typography, strong negative space and diagonal impact, evoking a grand character entrance.',
  },
  {
    id: 2,
    label: '三命 · 暗色背景 / 亮色主角',
    description: '深黑背景，极端去饱和灰度主调 + 高饱和点缀色，严格对齐零命构图。',
    promptTemplate:
      '输入图片为零命成图（编辑基础，位置已锁定），右下角附有角色三视图缩略图仅用于配色参考。你只需要对其做图像编辑风格的色彩变换。绝对禁止移动、缩放、旋转、裁切或重新生成画面中的任何元素。输出尺寸严格锁定为1536×1024像素（3:2横向构图），严禁改变画幅尺寸或裁剪范围。角色身体的轮廓、位置、大小、角度、文字的字形、字距、行距、与边缘的距离、被裁切的程度，全部锁定为输入图片中的样子，不可有任何像素级偏移。你唯一可以修改的只有：色彩调色、渲染风格、材质表现。具体渲染风格：将零命成图的暗色剪影风格变换为极端去饱和灰度主调 + 高饱和点缀色，呈现冷酷、锐利的酷感。你收到的参考板左侧为零命成图（编辑基础），右侧附带一张右下角极小缩略图为角色三视图，仅用于提取服装配色、花纹、配饰细节——严禁参考其姿势、构图或人物位置。再次强调：除色彩外，画面中的一切元素必须与输入图片（左侧零命成图）逐像素完全一致。画风与输入图片（零命成图）保持完全一致；色彩处理——极端去饱和灰度主调 + 高饱和点缀色：角色整体进行彻底去饱和处理，仅保留极少数指定点缀色；注意文字颜色不受去饱和影响，必须保留高饱和色彩；服装本体（上衣、裙子、裤子、外套等）必须与角色三视图（右下角缩略图）完全一致，不得自行修改或增减任何服装部件，仅可改变其色彩；严禁给角色添加任何原图中不存在的元素（口罩、面罩、眼镜、绷带、饰品、纹身、伤痕等），不得修改面部特征与表情；统一为黑白灰三色，建立从近白（亮度230-255）到近黑（亮度10-30）的完整灰阶，光照采用45度柔和顶光，通过强烈的块面光影明暗（高光→中间调→阴影）与清晰外轮廓线稿体现立体层次、布料褶皱与发丝质感；角色肌肤为浅灰至中灰色调（亮度100-180，完全去饱和）；重要：参考右下角三视图缩略图中角色的原始腿部/手臂装束——若原角色穿黑丝/连裤袜则保留，若原角色裸露肌肤则将零命图中的深色区域正常渲染为肤色，严禁无中生有添加黑丝；眼睛虹膜保留「{DOMINANT_COLOR}」（80%色彩饱和度），并带有明显的高光反射点；指定点缀部位（包括但不限于：披风、指甲、手套、唇舌、心形/星形等标志性配饰、发饰、道具挂饰、领结纹饰等）的颜色应恢复至与角色三视图（右下角缩略图）完全一致的配色，保留「{ACCENT_COLOR}」或「{DOMINANT_COLOR}」100%饱和色彩并在当前基础上提亮30%，与灰度主体形成强烈视觉焦点，除此之外角色全身不得出现任何其他颜色；背景与明暗对比：背景为统一深黑色暗调（RGB 8-15），可带有极微弱的工业噪点纹理，但不得出现任何具体场景、第二种颜色、渐变过渡或暗角；角色与背景形成极端强烈的明暗对比，角色外轮廓清晰锐利，高光区域可接近纯白；文字位置、大小、字形与零命成图完全一致，仅{NAME_TOP}和{NAME_BOTTOM}两个英文文字层；文字不透明度100%、完全实心，不可透过文字看到后方角色；{NAME_TOP}和{NAME_BOTTOM}的文字颜色强制使用{TEXT_BOTTOM}，100%不透明度实心字体，不得被去饱和处理影响，不得使用其他颜色',
      promptTemplateEn: 'This is an already-completed zero-fate image. You only need to perform an image-editing-style color transformation on it. It is ABSOLUTELY FORBIDDEN to move, scale, rotate, crop, or regenerate any element in the composition. Output dimensions are STRICTLY LOCKED to 1536×1024 pixels (3:2 landscape). Forbidden to change the frame dimensions or crop area in any way. The character\'s body silhouette, position, size, angle, as well as the text\'s letterforms, kerning, leading, distance from edges, and degree of crop — are ALL LOCKED to exactly what appears in the input image. Not a single pixel of offset is acceptable. The ONLY aspects you may modify are: color grading, rendering style, material expression. Specific rendering style: transform the dark silhouette aesthetic of the zero-fate image into extreme desaturated grayscale with high-saturation accent colors, presenting a cool, sharp, edgy feel. You receive: LEFT — the zero-fate image (editing base, position locked). RIGHT — a small thumbnail of the character three-view in the bottom-right corner, ONLY for extracting clothing colors, patterns, and accessory details — strictly forbid copying its pose or composition. Re-emphasize: except for color, every element in the image must be pixel-for-pixel identical to the input image (left side, zero-fate). {CHARACTER_TRAITS} Art style must match the input image (zero-fate). Color treatment — extreme desaturated grayscale + high-saturation accents: the entire character is thoroughly desaturated, retaining only a very small number of designated accent colors. Note: text color is NOT affected by desaturation and must retain high saturation. The clothing structure must not be altered; only color may be changed. Strictly forbid adding ANY element not present in the original image (including but not limited to masks, face coverings, glasses, bandages, accessories, tattoos, scars). Do NOT modify facial features or expressions. Colors unified to black/white/gray with a full grayscale range from near-white (brightness 230-255) to near-black (brightness 10-30), Lighting uses a soft 45-degree top light, expressed through strong blocky light/shadow modeling and clean contour line art to express three-dimensional layers, fabric folds, and hair texture. Character skin is light-gray to mid-gray (brightness 100-180, fully desaturated). IMPORTANT: Reference the three-view thumbnail in the bottom-right corner for the character\'s original leg/arm wear — if the character wears stockings/tights, keep them; if the character has bare skin, render the dark areas of the zero-fate image as normal skin tone. Do NOT invent stockings where none exist.. Iris retains {DOMINANT_COLOR} at 80% saturation with a visible specular highlight. Designated accent areas (cape, nails, gloves, lips, heart/star-shaped signature accessories, hair ornaments, prop pendants, bow-tie patterns etc.) should have their colors restored to exactly match the character three-view (bottom-right thumbnail), retaining {ACCENT_COLOR} or {DOMINANT_COLOR} at 100% saturation and brightened by an additional 30%, creating a strong visual focus against the grayscale figure. No other colors anywhere on the character. Background: uniform deep-black dark tone (RGB 8-15), may have extremely faint industrial noise texture but no specific scene, second color, gradient transition, or vignette. Extreme light/dark contrast — silhouette is sharp, highlights may approach pure white. Text position, size, and letterforms identical to zero-fate; only {NAME_TOP} and {NAME_BOTTOM} text layers. Text opacity 100%, completely solid. Both colors must use {TEXT_BOTTOM}, high saturation, 100% opacity solid type — must not be affected by the desaturation treatment. Must not use any other color.',
  },
  {
    id: 3,
    label: '六命 · 全彩 / 肤色高光',
    description: '全彩高饱和赛璐珞，明亮全彩印刷品美学，严格对齐零命构图。',
    promptTemplate:
      '输入图片为零命成图（编辑基础，位置已锁定），右下角附有角色三视图缩略图仅用于配色参考。你只需要对其做图像编辑风格的色彩变换。绝对禁止移动、缩放、旋转、裁切或重新生成画面中的任何元素。输出尺寸严格锁定为1536×1024像素（3:2横向构图），严禁改变画幅尺寸或裁剪范围。角色身体的轮廓、位置、大小、角度、文字的字形、字距、行距、与边缘的距离、被裁切的程度，全部锁定为输入图片中的样子，不可有任何像素级偏移。你唯一可以修改的只有：色彩调色、渲染风格、材质表现、服装删减（仅六命）。具体渲染风格：将零命成图的暗色剪影风格变换为全彩高饱和赛璐珞。你收到的参考板左侧为零命成图（编辑基础），右侧附带一张右下角极小缩略图为角色三视图，仅用于提取服装配色、花纹、配饰细节——严禁参考其姿势、构图或人物位置。再次强调：除色彩外，画面中的一切元素必须与输入图片（左侧零命成图）逐像素完全一致。画风与输入图片（零命成图）保持完全一致；色彩与上色——全彩高饱和赛璐珞：【强制要求 · 不可跳过——肌肤大幅露出】基于原角色服饰设计基因进行创新改造，保留原设计的配色、图案纹样与装饰元素，大幅增加肌肤展现。衣服可因不可抗因素（战斗、动作、环境）而导致撕裂/损毁，也可采用开放性设计/战损风格：① 开放性设计——缩短裙摆/改无袖/深V领/露背/露腰/热裤化；② 战损风——因战斗撕裂破损自然露肤。必须完成以下至少6项：1. 外套/披风去除或改造为短款 2. 护甲去除或改造为镂空 3. 裙摆改造为短裙/高开衩 4. 袖子改造为无袖/短袖 5. 领口改低露出锁骨与肩颈 6. 背部改为露背或绑带 7. 腰腹改为露腰或镂空 8. 腿部改造为热裤/短裤严禁因删减服装而移动角色的任何身体部位、改变姿势或调整构图。角色进行完整全彩高饱和赛璐珞上色。背景——纯白无杂质：纯白色（#FFFFFF）铺满整个画面背景区域，无任何渐变、噪点、纹理、阴影或暗角；文字位置、大小、字形与零命成图完全一致，仅{NAME_TOP}和{NAME_BOTTOM}两个英文文字层；文字不透明度100%、完全实心，不可透过文字看到后方角色；{NAME_TOP}文字颜色强制使用{TEXT_TOP_BRIGHT}，{NAME_BOTTOM}文字颜色强制使用{TEXT_BOTTOM}，两者均不得使用其他颜色。角色动态：{ACTION_POSE}；画面整体呈现慵懒私密的氛围感，如同角色在自己房间中毫无防备的放松瞬间。光照采用45度柔和顶光作为全局光源，全图所有元素均受此光源影响；服装与头发的亮暗由光照方向与布料褶皱、发丝走向共同决定，同一材质因褶皱朝向不同呈现不同明暗，形成自然光影层次；明暗交界清晰但不锐利，皮肤带有高光反射。重要：参考右下角三视图缩略图中角色的原始腿部/手臂装束——若原角色穿黑丝/连裤袜则保留，若原角色裸露肌肤则将零命图中的深色区域正常渲染为裸露肤色，严禁无中生有添加黑丝。整体为卸防感的非战斗姿态，衣装微松——脱去外套、松开领口、拉下领带，呈现私密状态。肌肤细节：皮肤带汗珠或自然油光，增强真实的体温感。质感与细节：强烈明暗对比，做旧噪点，斜切几何色块，工业贴纸UI质感，网点纸/半调纹理（halftone dot pattern），印刷做旧质感，扫描线；角色主体脸部清晰，细节高精度，整体呈现绝区零官方Mindscape Cinema影画的明亮全彩印刷品美学。',
      promptTemplateEn: 'Input is the zero-fate image (editing base, position locked) with a three-view thumbnail in the bottom-right corner for color reference only — you only need to perform an image-editing-style color transformation on it. It is ABSOLUTELY FORBIDDEN to move, scale, rotate, crop, or regenerate any element in the composition. Output dimensions are STRICTLY LOCKED to 1536×1024 pixels (3:2 landscape). Forbidden to change the frame dimensions or crop area in any way. The character\'s body silhouette, position, size, angle, as well as the text\'s letterforms, kerning, leading, distance from edges, and degree of crop — are ALL LOCKED to exactly what appears in the input image. Not a single pixel of offset is acceptable. The ONLY aspects you may modify are: color grading, rendering style, material expression. Specific rendering style: transform the dark silhouette aesthetic of the zero-fate image into full-color high-saturation cel-shading. You receive: LEFT — the zero-fate image (editing base, position locked). RIGHT — a small thumbnail of the character three-view in the bottom-right corner, ONLY for extracting clothing colors, patterns, and accessory details — strictly forbid copying its pose or composition. Re-emphasize: except for color, every element in the image must be pixel-for-pixel identical to the input image (left side, zero-fate). {CHARACTER_TRAITS} Art style must match the input image (zero-fate). Color & rendering — full-color high-saturation cel-shading: 【MANDATORY · DO NOT SKIP — MAXIMUM SKIN EXPOSURE】Redesign clothing based on the original character\'s design DNA, preserving original colors, patterns, and decorative elements, while greatly increasing skin exposure. Clothing may be torn/damaged due to force majeure (combat, action, environment), or adopt open redesign/battle-damaged style: ① Open redesign — crop skirts/sleeves, deep V-neck, open back, bare waist, hotpants; ② Battle-damaged — torn from combat, naturally revealing skin. Must complete at least 6: 1. Remove or crop jacket/cape 2. Remove or hollow out armor/coverings 3. Redesign skirt as mini/high-slit 4. Redesign sleeves as sleeveless/short 5. Lower neckline to expose collarbone and shoulders 6. Open back or add strap design 7. Expose waist or add side cutouts 8. Redesign legwear as shorts/hotpants. Forbidden to move any body part, change pose, or adjust composition as a result of clothing reduction. the character receives complete full-color high-saturation cel-shading, colors vivid, saturated, bright and dazzling. Strictly forbid dull, gray, desaturated or black-and-white treatment. Natural skin texture (warm peach skin tone with natural blush and specular highlights). Use {DOMINANT_COLOR} as the dominant color throughout the character\'s clothing, hair and accessories, with {ACCENT_COLOR} as glow, rim light, accent and atmospheric color for maximum color impact. Background — pure white, no impurities: pure white (#FFFFFF) filling the entire background area. No gradient, noise, texture, shadow, or vignette. Text position, size, and letterforms identical to zero-fate; only {NAME_TOP} and {NAME_BOTTOM} text layers. Text opacity 100%, completely solid.{NAME_TOP} color must use {TEXT_TOP_BRIGHT}. {NAME_BOTTOM} color must use {TEXT_BOTTOM}, high saturation. Must not use any other color. Character dynamic: {ACTION_POSE}. The overall mood is lazy and intimate — like a character relaxing defenselessly in their own room. Lighting uses a soft 45-degree top light as the global light source affecting all elements. The brightness of clothing and hair is determined jointly by light direction AND natural folds, creases, and hair flow — the same material may show different brightness depending on how its folds face the light, creating natural light-shadow modeling. Light-shadow boundary is clear but gentle, with skin specular highlights. IMPORTANT: Reference the three-view thumbnail for the character\'s original leg/arm wear — if stockings/tights exist, keep them; if bare skin, render dark areas as exposed skin. Do NOT invent stockings. The pose is defenseless and non-combat. Clothing is slightly loosened — jacket removed, collar undone, tie pulled down — conveying a private state. Skin details: skin has a subtle sweat or natural oil sheen, enhancing a realistic body-temperature feel. Texture & details: strong light/dark contrast, aged noise, diagonal geometric blocks, industrial sticker UI texture, halftone dot pattern, aged print texture, scan lines. Character\'s face clear, high-precision detail. Overall: ZZZ Official Mindscape Cinema bright full-color print aesthetic.',
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
): string {
  const upper = (name || 'CHARACTER').toUpperCase();
  const [top, bottom] = splitName(upper);
  const dominant = palette?.dominant ?? '#b026ff';
  const accent = palette?.accent ?? '#ff2d9b';
  const textTop = palette?.textTop ?? '#1a1a2e';
  const textBottom = palette?.textBottom ?? '#cc66ff';
  const textTopBright = palette?.textTopBright ?? '#e099ff';

  // Compose character dynamic + micro-dynamic into the ACTION_POSE placeholder.
  const actionPose = [characterDynamic, microDynamic].filter(Boolean).join('；')
    || '卸防感的非战斗姿态，放松慵懒毫无戒备';

  // Replace name/color markers first, then handle text toggle.
  let filled = template
    .replaceAll('{ACTION_POSE}', actionPose)
    .replaceAll('{CHARACTER_TRAITS}', characterTraits ? `，角色性格特点：${characterTraits}` : '')
    .replaceAll('{NAME_TOP}', top)
    .replaceAll('{NAME_BOTTOM}', bottom)
    .replaceAll('{NAME}', upper)
    .replaceAll('{DOMINANT_COLOR}', dominant)
    .replaceAll('{ACCENT_COLOR}', accent)
    .replaceAll('{TEXT_TOP}', textTop)
    .replaceAll('{TEXT_BOTTOM}', textBottom)
    .replaceAll('{TEXT_TOP_BRIGHT}', textTopBright);
  if (showText === false) {
    filled = filled.replace(
      /做旧印刷体英文「[^」]+」和「[^」]+」分别放置于两个角落[^']*/,
      '画面整洁不含任何文字，无水印',
    );
  }
  return (lang === 'en' ? '' : FIDELITY_PREFIX) + filled;
}
