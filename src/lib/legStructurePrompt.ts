/** Connection ownership, rather than merely counting visible feet. */
export const LEG_STRUCTURE_ZH = '【双腿连接校验】左右腿各自拥有独立的髋—大腿—膝—小腿—踝—脚连接。每个膝盖只接一条小腿，每条小腿只接一个脚踝和一只脚，不在大腿或膝盖处分叉出额外小腿。允许透视重叠与遮挡，但不共用关节，不重复补画鞋袜形成第三条腿；隐藏或出框部位保持原状，不强行补全。保留原镜头、透视、裁切和动作。';

export const LEG_STRUCTURE_EN = '[TWO LEG CHAINS] Each leg owns a distinct hip–thigh–knee–calf–ankle–foot chain. Each knee connects to only one calf; each calf ends in only one ankle and foot. Never branch an additional calf from a thigh or knee. Preserve perspective overlap and occlusion without sharing joints or duplicating footwear into a third leg. Keep hidden/off-frame parts hidden or off-frame; preserve the original camera, perspective, crop and action.';

export const LEG_REPAIR_ZH = `【多余腿局部修复】${LEG_STRUCTURE_ZH}结合用户指定的位置与原图连接关系定位多余分支，先辨认并保留正确的两条连接；用户明确指定保留的分支不得删除或替换。仅在本轮允许的编辑区域内，删除多余分支及其脚踝、鞋袜，恢复其后方背景或支撑面，并整理分叉处轮廓；不要只擦掉一只鞋却留下断腿，也不要擅自改成删除其他位置的脚。`;
