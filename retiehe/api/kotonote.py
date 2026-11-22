# -*- coding: utf-8 -*-
"""
言笺 KotoNote · 热铁盒网页托管 Python 云函数 + KV 数据库后端（零受限标准库依赖版）
部署路径: /api/kotonote.py
仅强制依赖内置模块 json，彻底规避云函数沙箱 ImportError 限制。
"""
import json

try:
    from datetime import datetime as _dt
except Exception:
    _dt = None

try:
    import time as _time
except Exception:
    _time = None

DB_NAME = "kotonote_db"
CHUNK_SIZE = 50

DEFAULT_SETTINGS = {
    "theme": "light",
    "order": "sequential",
    "durationMin": 15,
    "rate": 1.0,
    "langPauseSec": 2.5,
    "jpVoice": "",
}

SEED_WORDS_JSON = '[{"jp": "パラメータ", "kana": "", "zh": "参数", "en": "parameter", "category": "测试与硬件通用", "note": "（日常语境的引申义），表示对事物的限制条件"}, {"jp": "同等", "kana": "どうとう", "zh": "同等", "en": "equal / equivalent", "category": "测试与硬件通用", "note": ""}, {"jp": "バイアス", "kana": "", "zh": "偏差/偏置/偏见", "en": "bias", "category": "测试与硬件通用", "note": "统计学、机器学习中常译「偏差」，AI大模型语境常译「偏置」，社会语境中一般译为「偏见」。"}, {"jp": "縮小", "kana": "しゅくしょう", "zh": "缩小；缩小规模", "en": "reduce / shrink / scale down", "category": "测试与硬件通用", "note": ""}, {"jp": "グラファイト/黒鉛（こくえん）", "kana": "", "zh": "石墨", "en": "graphite", "category": "测试与硬件通用", "note": ""}, {"jp": "変化（へんか）/バリエーション", "kana": "", "zh": "变化；变动；", "en": "variation", "category": "测试与硬件通用", "note": ""}, {"jp": "ミリワット", "kana": "", "zh": "毫瓦 (mW)", "en": "milliwatt (mW)", "category": "测试与硬件通用", "note": ""}, {"jp": "", "kana": "", "zh": "显示驱动芯片", "en": "DDIC = Display Driver IC", "category": "测试与硬件通用", "note": "屏幕核心驱动 IC，含源极 / 栅极驱动、TDDI 触控显示一体芯片"}, {"jp": "", "kana": "", "zh": "动态工作功耗 / 有源功耗", "en": "Active Power", "category": "测试与硬件通用", "note": "DDIC active power：显示驱动芯片正常点亮画面、刷新像素时的动态运行功耗，单位 mW（毫瓦）"}, {"jp": "消費電力", "kana": "しょうひでんりょく", "zh": "功耗", "en": "power consumption", "category": "测试与硬件通用", "note": "Active power consumption\\n动态工作功耗 = DDIC active power\\n屏幕亮屏刷新、正常显示画面时驱动芯片产生的功耗"}, {"jp": "解像度", "kana": "", "zh": "分辨率/清晰率", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "ディスプレー", "kana": "", "zh": "显示器", "en": "display", "category": "测试与硬件通用", "note": ""}, {"jp": "組電池/電池パック", "kana": "", "zh": "组电池", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "単電池", "kana": "", "zh": "单电池", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "過充電試験", "kana": "", "zh": "过充试验", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "フェイル", "kana": "", "zh": "故障", "en": "fail", "category": "测试与硬件通用", "note": ""}, {"jp": "シャットダウン", "kana": "", "zh": "关机", "en": "shutdown", "category": "测试与硬件通用", "note": ""}, {"jp": "パラメーター", "kana": "", "zh": "参数/变量", "en": "parameter", "category": "测试与硬件通用", "note": ""}, {"jp": "インターフェース", "kana": "", "zh": "接口", "en": "interface", "category": "测试与硬件通用", "note": ""}, {"jp": "検証", "kana": "けんしょう", "zh": "验证", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "単体", "kana": "たんたい〇", "zh": "单体", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "デフォルト値", "kana": "", "zh": "默认值", "en": "default", "category": "测试与硬件通用", "note": ""}, {"jp": "", "kana": "", "zh": "延迟", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "リアルタイム性", "kana": "", "zh": "实时性", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "ドッキング", "kana": "", "zh": "对接", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "タイピング", "kana": "", "zh": "输入", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "プロセッサ/CPU", "kana": "", "zh": "处理器", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "ストレージ", "kana": "", "zh": "储存", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "ベンダ", "kana": "", "zh": "供应商", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "スナップ", "kana": "", "zh": "卡扣/按扣", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "縦線/横線", "kana": "", "zh": "竖线/横线", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "スペック", "kana": "", "zh": "规格、参数", "en": "spec", "category": "测试与硬件通用", "note": ""}, {"jp": "アイコン", "kana": "", "zh": "图标", "en": "icon", "category": "测试与硬件通用", "note": ""}, {"jp": "ドロップテスト/落下試験", "kana": "", "zh": "跌落测试", "en": "drop", "category": "测试与硬件通用", "note": ""}, {"jp": "微落下試験", "kana": "", "zh": "微跌测试", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "気密性", "kana": "", "zh": "气密", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "図面", "kana": "", "zh": "图纸", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "シールド", "kana": "", "zh": "屏蔽罩/保护罩", "en": "EMI～", "category": "测试与硬件通用", "note": ""}, {"jp": "ファブリック・導電布", "kana": "どうでんふ", "zh": "导电布", "en": "conductive fabric", "category": "测试与硬件通用", "note": ""}, {"jp": "グラファイトシート", "kana": "", "zh": "石墨片", "en": "graphite", "category": "测试与硬件通用", "note": ""}, {"jp": "敷き詰める", "kana": "", "zh": "铺满; 布满; 铺满整个表面", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "記載⓪", "kana": "", "zh": "写上", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "仕様", "kana": "しよう", "zh": "规格；方式；方法", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "引き延ばす効果", "kana": "", "zh": "延伸效果（叠层侧视图用）", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "フレキシブルプリント配線板", "kana": "", "zh": "柔性线路板", "en": "Flexible Printed Circuits", "category": "测试与硬件通用", "note": ""}, {"jp": "端", "kana": "はし⓪", "zh": "边缘；末端；起点；", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "全張り", "kana": "ぜんばっり", "zh": "全贴合", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "空気抜け", "kana": "", "zh": "排气；抽气；放气", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "追記", "kana": "ついき⓪", "zh": "追加记录；补充说明", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "コーティング", "kana": "", "zh": "涂层；镀膜；覆膜", "en": "coating", "category": "测试与硬件通用", "note": ""}, {"jp": "クラック", "kana": "", "zh": "裂缝", "en": "crack", "category": "测试与硬件通用", "note": ""}, {"jp": "スジ", "kana": "", "zh": "条纹", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "勝手に再起動かかる", "kana": "", "zh": "自动重启", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "電源が付かなくなった", "kana": "", "zh": "无法开机", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "フリーズする", "kana": "", "zh": "卡死/卡住", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "傷", "kana": "", "zh": "划痕", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "初期化", "kana": "", "zh": "恢复出厂设置", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "クロス検証", "kana": "", "zh": "交叉验证", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "BTBインターフェース", "kana": "", "zh": "BTB接口", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "コンポーネント", "kana": "", "zh": "组件", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "バックライトは点灯する", "kana": "", "zh": "背光点亮", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "ビルド番号", "kana": "", "zh": "版本号", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "通常の端末", "kana": "", "zh": "正常设备/机器", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "電源投入不可", "kana": "", "zh": "无法上电", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "電源落ちる / 電源が切れる", "kana": "", "zh": "断电", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "筐体⓪", "kana": "きょうたい", "zh": "外壳/壳体", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "水没検知シール / すいぼつ / 浸水ラベル / しんすい⓪", "kana": "", "zh": "进水/防水标签", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "~にじみ無し", "kana": "", "zh": "无渗色", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "勘合⓪", "kana": "かんごう", "zh": "对照/核对/验证", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "端子①", "kana": "たんし", "zh": "接头；接线端；端子", "en": "", "category": "测试与硬件通用", "note": "CN=pin脚"}, {"jp": "焼き付き", "kana": "", "zh": "烧屏", "en": "Screen Burn-in", "category": "测试与硬件通用", "note": ""}, {"jp": "デモ画面", "kana": "", "zh": "演示画面", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "黄色まだら / 黄色かかった", "kana": "", "zh": "黄斑 / 泛黄", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "お客様の了承", "kana": "", "zh": "顾客/客户同意", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "色味③", "kana": "いろみ", "zh": "色深/色彩", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "追加解析に回す", "kana": "", "zh": "进一步分析", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "症状はDisplayについて回る", "kana": "", "zh": "现象随屏走", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "インフォ", "kana": "", "zh": "咨询窗口", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "たらいまわしにされた", "kana": "", "zh": "遭到推诿", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "預かり修理に納得されない", "kana": "", "zh": "（客户）不接受寄存维修", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "テクニカルアドバイザー", "kana": "", "zh": "技术顾问", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "バイブ", "kana": "", "zh": "震动", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "まえだおし⓪  前倒しする・前倒しになる / 繰り上げる・早める", "kana": "", "zh": "提前", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "オープン", "kana": "", "zh": "开路（膜缺失 / 刻穿 / 过孔处断裂）", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "仕組み", "kana": "しくみ⓪", "zh": "计划，安排", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "ファーム・ / ファームウエア", "kana": "", "zh": "固件", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "調整がしょうじたときに", "kana": "", "zh": "", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "セット側", "kana": "", "zh": "整机", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "銅シート・銅のパーツ（零件；部件；配件）", "kana": "", "zh": "铜片", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "けいじょう⓪", "kana": "", "zh": "形状", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "ワースト条件", "kana": "", "zh": "最坏情况/最差条件", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "性能比較", "kana": "", "zh": "", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "機種①②", "kana": "きしゅ", "zh": "机型", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "あくまでも", "kana": "", "zh": "终究", "en": "", "category": "测试与硬件通用", "note": "これはあくまでもネット上で収集した情報です。"}, {"jp": "ミドルフレーム", "kana": "", "zh": "中框", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "ソリューション", "kana": "", "zh": "解决方案", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "逆算", "kana": "ぎゃくさん⓪", "zh": "倒算；倒推", "en": "", "category": "测试与硬件通用", "note": ""}, {"jp": "バックプレート", "kana": "", "zh": "背板", "en": "backing plate", "category": "测试与硬件通用", "note": ""}, {"jp": "視野角", "kana": "しやかく", "zh": "视角", "en": "View Angles", "category": "显示面板与光学触控", "note": ""}, {"jp": "コントラスト比", "kana": "コントラストひ", "zh": "对比度", "en": "Contrast Ratio", "category": "显示面板与光学触控", "note": ""}, {"jp": "応答時間", "kana": "おうとうじかん", "zh": "响应时间", "en": "Response Time", "category": "显示面板与光学触控", "note": ""}, {"jp": "斜め色シフト", "kana": "ななめいろシフト", "zh": "偏角色移/侧视色偏", "en": "Off-angle color shift", "category": "显示面板与光学触控", "note": ""}, {"jp": "色再現範囲（いろさいげんはんい） / カラーガマット", "kana": "", "zh": "色域", "en": "Color Gamut", "category": "显示面板与光学触控", "note": ""}, {"jp": "黒レベル", "kana": "くろレベル", "zh": "黑色亮度/黑位", "en": "Black", "category": "显示面板与光学触控", "note": ""}, {"jp": "輝度減衰", "kana": "きどげんすい", "zh": "亮度衰减", "en": "Luminance Decay", "category": "显示面板与光学触控", "note": ""}, {"jp": "色均一性", "kana": "いろきんいつせい", "zh": "色彩均匀度", "en": "Color uniformity", "category": "显示面板与光学触控", "note": ""}, {"jp": "寿命", "kana": "じゅみょう", "zh": "使用寿命", "en": "Life Time", "category": "显示面板与光学触控", "note": ""}, {"jp": "焼き付き", "kana": "やきつき", "zh": "图像残留/烧屏", "en": "Image Sticking", "category": "显示面板与光学触控", "note": ""}, {"jp": "クロストーク", "kana": "", "zh": "串扰", "en": "Crosstalk", "category": "显示面板与光学触控", "note": ""}, {"jp": "常時表示（じょうじひょうじ） / AOD", "kana": "", "zh": "息屏显示", "en": "AOD（Always On Display）", "category": "显示面板与光学触控", "note": ""}, {"jp": "OLEDアレイ", "kana": "", "zh": "有机发光二极管阵列", "en": "OLED Array", "category": "显示面板与光学触控", "note": ""}, {"jp": "パッシブマトリクスOLED", "kana": "", "zh": "被动矩阵有机发光二极管", "en": "Passive Matrix OLED (PMOLED)", "category": "显示面板与光学触控", "note": ""}, {"jp": "アクティブマトリクスOLED", "kana": "", "zh": "主动矩阵有机发光二极管", "en": "Active Matrix OLED (AMOLED)", "category": "显示面板与光学触控", "note": ""}, {"jp": "薄膜トランジスタ", "kana": "", "zh": "薄膜晶体管", "en": "Thin Film Transistor (TFT)", "category": "显示面板与光学触控", "note": ""}, {"jp": "ピクセルアレイ", "kana": "", "zh": "像素阵列", "en": "Pixel Array", "category": "显示面板与光学触控", "note": ""}, {"jp": "サブピクセル", "kana": "", "zh": "子像素", "en": "Sub-pixel", "category": "显示面板与光学触控", "note": ""}, {"jp": "ペンタイル配列", "kana": "", "zh": "Pentile排列", "en": "Pentile Matrix", "category": "显示面板与光学触控", "note": ""}, {"jp": "ストライプ配列", "kana": "", "zh": "条纹排列", "en": "Stripe Arrangement", "category": "显示面板与光学触控", "note": ""}, {"jp": "デルタ配列", "kana": "", "zh": "Delta排列", "en": "Delta Arrangement", "category": "显示面板与光学触控", "note": ""}, {"jp": "有機発光層", "kana": "", "zh": "有机发光层", "en": "Organic Emitting Layer", "category": "显示面板与光学触控", "note": ""}, {"jp": "正孔輸送層", "kana": "", "zh": "空穴传输层", "en": "Hole Transport Layer (HTL)", "category": "显示面板与光学触控", "note": ""}, {"jp": "電子輸送層", "kana": "", "zh": "电子传输层", "en": "Electron Transport Layer (ETL)", "category": "显示面板与光学触控", "note": ""}, {"jp": "アノード", "kana": "", "zh": "阳极", "en": "Anode", "category": "显示面板与光学触控", "note": ""}, {"jp": "カソード", "kana": "", "zh": "阴极", "en": "Cathode", "category": "显示面板与光学触控", "note": ""}, {"jp": "基板", "kana": "", "zh": "衬底", "en": "Substrate", "category": "显示面板与光学触控", "note": ""}, {"jp": "蒸着", "kana": "", "zh": "蒸镀", "en": "Vacuum Thermal Evaporation", "category": "显示面板与光学触控", "note": ""}, {"jp": "インクジェット印刷", "kana": "", "zh": "喷墨打印", "en": "Inkjet Printing", "category": "显示面板与光学触控", "note": ""}, {"jp": "フレキシブルOLEDアレイ", "kana": "", "zh": "柔性OLED阵列", "en": "Flexible OLED Array", "category": "显示面板与光学触控", "note": ""}, {"jp": "折りたたみ式OLEDアレイ", "kana": "", "zh": "折叠OLED阵列", "en": "Foldable OLED Array", "category": "显示面板与光学触控", "note": ""}, {"jp": "ウェアラブルOLEDアレイ", "kana": "", "zh": "可穿戴OLED阵列", "en": "Wearable OLED Array", "category": "显示面板与光学触控", "note": ""}, {"jp": "OLEDセンシングアレイ", "kana": "", "zh": "OLED传感阵列", "en": "OLED Sensing Array", "category": "显示面板与光学触控", "note": ""}, {"jp": "光遺伝学刺激アレイ", "kana": "", "zh": "光遗传刺激阵列", "en": "Optogenetic Stimulation Array", "category": "显示面板与光学触控", "note": ""}, {"jp": "歩留まり", "kana": "", "zh": "良率", "en": "Yield", "category": "显示面板与光学触控", "note": ""}, {"jp": "開口率", "kana": "", "zh": "开口率", "en": "Aperture Ratio", "category": "显示面板与光学触控", "note": ""}, {"jp": "近眼表示", "kana": "", "zh": "近眼显示", "en": "Near-eye Display", "category": "显示面板与光学触控", "note": ""}, {"jp": "CNCカッティング", "kana": "", "zh": "CNC切割", "en": "CNC Cutting (Computer Numerical Control Cutting)", "category": "显示面板与光学触控", "note": "CNC切割通过预编程的加工代码，用自动化设备，控制切割刀具/高能束（激光、等离子等）按照设定路径自动切割金属、塑料、木材、玻璃、复合材料等各类材料"}, {"jp": "防指紋コーティング", "kana": "ぼうしもんコーティング", "zh": "抗指纹涂层 / AF 镀膜", "en": "anti-fingerprint coating / AF coating", "category": "显示面板与光学触控", "note": "日语显示 / 电子行业中，「指紋防止」是最常用的标准译法；\\n「アンチフィンガープリント」为片假名音译，多用于技术资料和产品规格书；\\n「防指紋」（ぼうしもん）也是常见写法，多用于镀膜、涂层相关语境"}, {"jp": "汚れ防止コート / アンチスマッジ", "kana": "", "zh": "防污膜/玻璃（疏水防尘）", "en": "Anti-Smudge/AS", "category": "显示面板与光学触控", "note": ""}, {"jp": "アンチリフレクション / 反射防止コーティング", "kana": "", "zh": "减反射膜 / AR 膜/抗反增透膜", "en": "Anti-Reflection coating (AR)", "category": "显示面板与光学触控", "note": ""}, {"jp": "反射防止複合コート", "kana": "", "zh": "AR 复合镀膜", "en": "AR composite coating", "category": "显示面板与光学触控", "note": ""}, {"jp": "反射防止処理", "kana": "", "zh": "减反射处理", "en": "Anti-reflection treatment", "category": "显示面板与光学触控", "note": ""}, {"jp": "AR+AF 二層コーティング", "kana": "", "zh": "AR+AF 双层膜", "en": "AR+AF coating", "category": "显示面板与光学触控", "note": ""}, {"jp": "", "kana": "", "zh": "防眩光", "en": "Anti-Glare/AG", "category": "显示面板与光学触控", "note": ""}, {"jp": "相関色温度", "kana": "そうかんしょくおんど", "zh": "色温", "en": "Correlated Color Temperature（CCT）", "category": "显示面板与光学触控", "note": ""}, {"jp": "色ずれ、カラーシフト", "kana": "", "zh": "色偏（通用）", "en": "Color shift", "category": "显示面板与光学触控", "note": ""}, {"jp": "黄変", "kana": "おうへん", "zh": "底色偏黄 / 黄变", "en": "Yellow tint", "category": "显示面板与光学触控", "note": ""}, {"jp": "TCP", "kana": "テープキャリアパッケージ", "zh": "TCP（载带封装，驱动 IC 柔性载带）", "en": "TCP（Tape Carrier Package）", "category": "显示面板与光学触控", "note": ""}, {"jp": "TN：ツイステッドネマチック", "kana": "", "zh": "扭曲向列型液晶", "en": "TN：Twisted Nematic", "category": "显示面板与光学触控", "note": "基础液晶材质，成本低、响应快，但可视角度差，早年电脑显示器、低端屏常用。"}, {"jp": "STN：スーパーツイステッドネマチック", "kana": "", "zh": "超扭曲向列型液晶", "en": "STN：Super Twisted Nematic", "category": "显示面板与光学触控", "note": "扭曲角度更大，对比度优于 TN，多用于老式电子表、工控单色小屏。"}, {"jp": "ヨウ素", "kana": "", "zh": "碘", "en": "iodine", "category": "显示面板与光学触控", "note": ""}, {"jp": "TAC フィルム", "kana": "", "zh": "TAC 膜", "en": "Triacetate Cellulose Film", "category": "显示面板与光学触控", "note": "三醋酸纤维素薄膜，LCD 偏光片核心基材，表面可做各类功能涂层"}, {"jp": "AG（防眩）", "kana": "", "zh": "AG 防眩膜", "en": "Anti-Glare", "category": "显示面板与光学触控", "note": "表面微粒子凹凸结构，散射外界强光，消除屏幕反光刺眼问题"}, {"jp": "LR 低反射", "kana": "", "zh": "LR 低反射", "en": "Low Reflection", "category": "显示面板与光学触控", "note": "降低界面反射率，减少环境倒影，提升户外可视性"}, {"jp": "CHC ハードコート", "kana": "", "zh": "CHC 透明硬化", "en": "Clear Hard Coating", "category": "显示面板与光学触控", "note": "高透明硬质涂层，提升膜层耐刮擦、耐磨性能，保护面板"}, {"jp": "AR 反射防止膜", "kana": "", "zh": "AR 防反射膜", "en": "Anti-Reflection", "category": "显示面板与光学触控", "note": "多层光学干涉涂层，大幅降低屏幕反射，对比度更高"}, {"jp": "AG+LR 複合フィルム", "kana": "", "zh": "AG+LR 复合膜", "en": "Anti-Glare + Low Reflection", "category": "显示面板与光学触控", "note": "同时具备防眩光、低反射双重效果，多用于电视大屏"}, {"jp": "CHC+LR 複合フィルム", "kana": "", "zh": "CHC+LR 复合膜", "en": "Clear Hard Coating + Low Reflection", "category": "显示面板与光学触控", "note": "兼顾耐磨抗刮与低反射，适配手机、平板小型终端"}, {"jp": "TN モード", "kana": "ツイステッドネマチック", "zh": "扭曲向列相模式（普通显示模式）", "en": "Twisted Nematic，TN", "category": "显示面板与光学触控", "note": "成本低、响应速度快；缺点是可视角度极小，侧看会偏色发白，多用于老式显示器、低端工控屏"}, {"jp": "IPS モード", "kana": "", "zh": "共面开关模式（广角显示）", "en": "In-Plane Switching，IPS", "category": "显示面板与光学触控", "note": "色彩均匀、左右上下视角均衡，色彩还原优秀；广泛用于电脑显示器、笔记本、监控屏"}, {"jp": "FFS モード", "kana": "", "zh": "场边缘开关模式", "en": "Fringe-Field Switching，FFS", "category": "显示面板与光学触控", "note": "IPS 衍生改良型，透光率更高、功耗更低，是手机 LCD 屏幕主流技术"}, {"jp": "VA モード", "kana": "", "zh": "垂直取向模式", "en": "Vertical Alignment，VA", "category": "显示面板与光学触控", "note": "原生对比度极高、黑色纯净度好；多用于液晶电视、高端曲面显示器，垂直视角略弱于 IPS"}, {"jp": "双棱镜片贴合", "kana": "", "zh": "POP", "en": "Prism on Prism", "category": "显示面板与光学触控", "note": "两层棱镜片背靠背贴合，三角棱纹相对"}, {"jp": "棱镜片贴扩散片", "kana": "", "zh": "POD", "en": "Prism on Diffuser", "category": "显示面板与光学触控", "note": "棱镜片微结构朝上，下方复合扩散片基底"}, {"jp": "扩散片贴棱镜片", "kana": "", "zh": "DOP", "en": "Diffuser on Prism", "category": "显示面板与光学触控", "note": "扩散粒子层朝上，底层复合棱镜片"}, {"jp": "波打ち（なみうち）、ウェーブ", "kana": "", "zh": "波浪纹、水波纹", "en": "waving", "category": "显示面板与光学触控", "note": "光学膜 / 导光板 / 偏光片出现连续波浪状起伏外观不良，大面积周期性凹凸纹路"}, {"jp": "シワ、皺", "kana": "しわ", "zh": "褶皱、起皱", "en": "wrinkle", "category": "显示面板与光学触控", "note": "光学膜 / 偏光片 / 导光板外观不良，膜材表面出现波浪状凹凸纹路"}, {"jp": "ワーク", "kana": "", "zh": "工件 / 待贴合基板", "en": "Work / Workpiece", "category": "显示面板与光学触控", "note": ""}, {"jp": "ステージ", "kana": "", "zh": "载台、工装平台", "en": "Stage", "category": "显示面板与光学触控", "note": ""}, {"jp": "ギャップ", "kana": "", "zh": "间隙", "en": "GAP", "category": "显示面板与光学触控", "note": ""}, {"jp": "OCA 光学粘着フィルム", "kana": "", "zh": "固态光学胶", "en": "OCA (Optical Clear Adhesive)", "category": "显示面板与光学触控", "note": ""}, {"jp": "OCR 光学透明樹脂", "kana": "", "zh": "液态光学胶", "en": "OCR (Optical Clear Resin)", "category": "显示面板与光学触控", "note": ""}, {"jp": "パーティクル、異物", "kana": "", "zh": "微粒、异物、尘点", "en": "particle", "category": "显示面板与光学触控", "note": ""}, {"jp": "チャンバー", "kana": "", "zh": "腔体、真空腔", "en": "chamber", "category": "显示面板与光学触控", "note": "设备密闭真空工作腔，贴合、脱泡、镀膜、液晶灌注设备核心密闭空间"}, {"jp": "BM ブラックマトリックス", "kana": "", "zh": "BM 黑矩阵", "en": "BM（Black Matrix）", "category": "显示面板与光学触控", "note": "面板边缘黑色遮光油墨，印刷在彩膜基板四周，遮挡像素漏光、分隔 RGB 子像素，印刷后会形成台阶段差；\\n黑色遮光网格层，隔绝相邻像素漏光，避免像素混色、画面发雾，同时遮挡边缘走线，防止透光干扰显示效果。"}, {"jp": "ベゼル、額縁", "kana": "", "zh": "边框 / 遮蔽围边", "en": "Bezel", "category": "显示面板与光学触控", "note": "盖板、触控屏边缘油墨围边，或屏幕金属窄边框；印刷层存在厚度，在贴合面形成凹凸段差"}, {"jp": "ムラ", "kana": "", "zh": "色斑、亮度不均、云斑", "en": "Mura", "category": "显示面板与光学触控", "note": "屏幕点亮后出现明暗不均、色块、雾状色差，是 LCD/OLED 最典型光学不良统称"}, {"jp": "VSP", "kana": "", "zh": "触控正信号", "en": "VSP", "category": "显示面板与光学触控", "note": "Touch Sensor Positive，触控差分正信号；\\n触控 IC 通过 VSP、VSN 差分信号扫描 ITO 感应线路，识别触摸点位。"}, {"jp": "VSN", "kana": "", "zh": "触控负信号", "en": "VSN", "category": "显示面板与光学触控", "note": "Touch Sensor Negative，触控差分负信号"}, {"jp": "VDD", "kana": "", "zh": "供电电源正极", "en": "VDD", "category": "显示面板与光学触控", "note": "芯片、触控线路工作供电电压；给触控 IC、Sensor 回路提供工作电压。"}, {"jp": "TVS", "kana": "", "zh": "瞬态抑制二极管", "en": "TVS", "category": "显示面板与光学触控", "note": "防静电 ESD 保护元器件"}, {"jp": "GND", "kana": "", "zh": "接地、地电位", "en": "GND", "category": "显示面板与光学触控", "note": "地、电源负极参考电位；对地阻抗 = 线路与 GND 之间的电阻值；\\n电路零电位基准点，所有电压的参考零点；屏蔽膜、铁框、IC、FPC 走线均需连接 GND，用于泄放静电、EMI 噪声，稳定触控 TX/RX 与 VCOM 电位，避免跳点、闪屏。"}, {"jp": "DSTB", "kana": "", "zh": "深度触控检测缓冲信号", "en": "DSTB", "category": "显示面板与光学触控", "note": "搭配压力触控方案的检测缓冲信号线"}, {"jp": "レポートレート", "kana": "レポートレート", "zh": "报点率", "en": "Report Rate", "category": "显示面板与光学触控", "note": "触控芯片每秒向主控端上报触控坐标点位的次数，单位 Hz，数值越高触控跟手性越好，游戏场景对该指标要求极高"}, {"jp": "治具（ジグ）、固定冶具", "kana": "", "zh": "治具、工装夹具", "en": "Jig / Fixture", "category": "显示面板与光学触控", "note": "生产、测试设备中用于固定、定位工件的专用工装，保障对位精度与操作稳定性"}, {"jp": "送信電極", "kana": "そうしんでんきょく", "zh": "发射电极（TX）", "en": "Transmit (TX) Electrode", "category": "显示面板与光学触控", "note": "触控 IC 向外输出交变驱动信号的电极，是电容信号的发射端，与 RX 电极垂直交叉构成触控感应矩阵"}, {"jp": "受信電極", "kana": "じゅしんでんきょく", "zh": "接收电极（RX）", "en": "Receive (RX) Electrode", "category": "显示面板与光学触控", "note": "捕捉 TX 发射电场产生的电容变化信号的电极，将感应数据回传至触控 IC，完成触控坐标计算"}, {"jp": "シール剤（ざい） / 枠膠（わくごう）", "kana": "", "zh": "封框胶", "en": "Sealant / Frame Glue", "category": "显示面板与光学触控", "note": "边框密封胶，用于粘接上下两块玻璃基板，密封液晶腔体，锁住内部液晶，隔绝外界水汽、灰尘进入盒内"}]'

_ACCENT_CHARS = set("⓪①②③④⑤⑥⑦⑧⑨〇")


def now_str():
    if _dt is not None:
        try:
            return _dt.now().strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            pass
    if _time is not None:
        try:
            return _time.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            pass
    return ""


def short_stamp():
    if _dt is not None:
        try:
            return _dt.now().strftime("%m-%d %H:%M")
        except Exception:
            pass
    if _time is not None:
        try:
            return _time.strftime("%m-%d %H:%M")
        except Exception:
            pass
    return "刚刚"


def _is_kana_char(ch):
    code = ord(ch)
    return (0x3041 <= code <= 0x3096) or (0x30A1 <= code <= 0x30FA) or ch in "ー・" or ch in _ACCENT_CHARS


def _is_hiragana_char(ch):
    code = ord(ch)
    return (0x3041 <= code <= 0x3096) or ch == "ー" or ch in _ACCENT_CHARS


def _is_kanji_char(ch):
    code = ord(ch)
    return (0x4E00 <= code <= 0x9FFF) or ch == "々"


def _is_kana_only(s):
    s = s.strip()
    if not s:
        return False
    for ch in s:
        if ch.isspace():
            continue
        if not _is_kana_char(ch):
            return False
    return True


def split_jp_kana(jp_raw):
    """Pure-Python JP/kana splitter (no re module required)."""
    jp = (jp_raw or "").strip()
    if not jp:
        return "", ""

    lines = [line.strip() for line in jp.splitlines() if line.strip()]
    if len(lines) == 2 and _is_kana_only(lines[1]) and not _is_kana_only(lines[0]):
        return lines[0], lines[1]

    # Single word with trailing full-width parenthesized kana: e.g. 視野角（しやかく）
    if jp.endswith("）") and "（" in jp and "/" not in jp and "\n" not in jp:
        left_idx = jp.rfind("（")
        head = jp[:left_idx].strip()
        inner = jp[left_idx + 1 : -1].strip()
        if head and inner and "（" not in head and "(" not in head and _is_kana_only(inner):
            return head, inner

    # Leading kana + space/full-width-space + kanji: e.g. けんしょう　検証
    normalized_ws = jp.replace("\u3000", " ")
    if " " in normalized_ws and "\n" not in normalized_ws:
        parts = [p for p in normalized_ws.split(" ") if p]
        if len(parts) == 2 and _is_kana_only(parts[0]) and not _is_kana_only(parts[1]):
            return parts[1].strip(), parts[0].strip()

    # Compact leading hiragana + kanji: e.g. ぎゃくさん⓪逆算
    if "\n" not in jp and " " not in normalized_ws and "/" not in jp:
        idx = 0
        n = len(jp)
        while idx < n and _is_hiragana_char(jp[idx]):
            idx += 1
        if 0 < idx < n:
            tail = jp[idx:]
            if all(_is_kanji_char(c) or c in _ACCENT_CHARS for c in tail) and any(_is_kanji_char(c) for c in tail):
                return tail.strip(), jp[:idx].strip()

    return (" / ".join(lines) if len(lines) > 1 else jp), ""


def parse_tsv_rows(raw_text):
    """Pure-Python RFC-style TSV parser supporting multi-line double-quoted fields."""
    rows = []
    row = []
    field = []
    in_quotes = False
    i = 0
    n = len(raw_text)

    while i < n:
        ch = raw_text[i]
        if in_quotes:
            if ch == '"':
                if i + 1 < n and raw_text[i + 1] == '"':
                    field.append('"')
                    i += 2
                    continue
                in_quotes = False
                i += 1
                continue
            field.append(ch)
            i += 1
            continue

        if ch == '"' and not field:
            in_quotes = True
            i += 1
            continue
        if ch == "\t":
            row.append("".join(field))
            field = []
            i += 1
            continue
        if ch == "\r":
            if i + 1 < n and raw_text[i + 1] == "\n":
                i += 1
            row.append("".join(field))
            rows.append(row)
            row = []
            field = []
            i += 1
            continue
        if ch == "\n":
            row.append("".join(field))
            rows.append(row)
            row = []
            field = []
            i += 1
            continue

        field.append(ch)
        i += 1

    if field or row:
        row.append("".join(field))
        rows.append(row)
    return rows


def format_tsv_field(val):
    s = str(val or "")
    if "\t" in s or "\n" in s or "\r" in s or '"' in s:
        return '"' + s.replace('"', '""') + '"'
    return s


def build_tsv_text(header, data_rows):
    lines = ["\t".join(format_tsv_field(c) for c in header)]
    for r in data_rows:
        lines.append("\t".join(format_tsv_field(c) for c in r))
    return "\n".join(lines) + "\n"


# ---------- Retiehe KV Database Helpers ----------
db = Database(DB_NAME)


def kv_get(key, default=None):
    try:
        raw = db.get(key)
    except Exception:
        return default
    if raw is None or raw == "":
        return default
    if isinstance(raw, (dict, list, int, float, bool)):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return raw


def kv_set(key, value):
    db.set(key, json.dumps(value, ensure_ascii=False))


def kv_delete(key):
    try:
        db.delete(key)
    except Exception:
        pass


def load_meta():
    meta = kv_get("meta")
    if not isinstance(meta, dict):
        meta = {"seeded": False, "chunkCount": 0, "nextWordId": 1, "nextEntryId": 1}
    return meta


def save_meta(meta):
    kv_set("meta", meta)


def load_words():
    meta = load_meta()
    if not meta.get("seeded"):
        return seed_initial_words()
    chunk_count = int(meta.get("chunkCount", 0))
    words = []
    for i in range(chunk_count):
        chunk = kv_get("words_chunk_" + str(i), [])
        if isinstance(chunk, list):
            words.extend(chunk)
    return words


def save_words(words, meta=None):
    if meta is None:
        meta = load_meta()
    old_count = int(meta.get("chunkCount", 0))
    new_count = (len(words) + CHUNK_SIZE - 1) // CHUNK_SIZE if words else 0
    for i in range(new_count):
        chunk = words[i * CHUNK_SIZE : (i + 1) * CHUNK_SIZE]
        kv_set("words_chunk_" + str(i), chunk)
    for j in range(new_count, old_count):
        kv_delete("words_chunk_" + str(j))
    meta["seeded"] = True
    meta["chunkCount"] = new_count
    save_meta(meta)


def seed_initial_words():
    ts = now_str()
    raw_items = json.loads(SEED_WORDS_JSON)
    words = []
    next_id = 1
    for item in raw_items:
        words.append(
            {
                "id": next_id,
                "jp": item.get("jp", ""),
                "kana": item.get("kana", ""),
                "zh": item.get("zh", ""),
                "en": item.get("en", ""),
                "category": item.get("category", "未分类"),
                "note": item.get("note", ""),
                "created_at": ts,
                "updated_at": ts,
                "entries": [],
            }
        )
        next_id += 1
    words.reverse()
    meta = {"seeded": True, "chunkCount": 0, "nextWordId": next_id, "nextEntryId": 1}
    save_words(words, meta)
    return words


def load_scratch():
    sc = kv_get("scratch")
    if not isinstance(sc, dict):
        sc = {"text": "", "updated_at": now_str(), "entries": []}
    if not isinstance(sc.get("entries"), list):
        sc["entries"] = []
    return sc


def save_scratch(sc):
    sc["updated_at"] = now_str()
    kv_set("scratch", sc)
    return sc


def load_settings():
    saved = kv_get("settings")
    result = dict(DEFAULT_SETTINGS)
    if isinstance(saved, dict):
        for k in DEFAULT_SETTINGS:
            if k in saved:
                result[k] = saved[k]
    return result


def save_settings(patch):
    cur = load_settings()
    if isinstance(patch, dict):
        for k in DEFAULT_SETTINGS:
            if k in patch:
                cur[k] = patch[k]
    kv_set("settings", cur)
    return cur


def compute_categories(words):
    counts = {}
    for w in words:
        cat = (w.get("category") or "未分类").strip() or "未分类"
        counts[cat] = counts.get(cat, 0) + 1
    ordered = sorted(counts.items(), key=lambda x: (-x[1], x[0]))
    return [{"name": k, "count": v} for k, v in ordered]


def parse_batch_text(raw_text, fmt="tsv", default_category="未分类"):
    items = []
    if not (raw_text or "").strip():
        return items
    cat_name = (default_category or "未分类").strip() or "未分类"
    if fmt == "tsv":
        for row in parse_tsv_rows(raw_text):
            cols = [c.strip() for c in row]
            while len(cols) < 4:
                cols.append("")
            zh_raw, en, jp_raw, note = cols[0], cols[1], cols[2], cols[3]
            if zh_raw == "中文" and en.lower() == "english":
                continue
            if not (zh_raw or en or jp_raw):
                continue
            zh = " / ".join([l.strip() for l in zh_raw.splitlines() if l.strip()])
            jp, kana = split_jp_kana(jp_raw)
            items.append(
                {
                    "jp": jp,
                    "kana": kana,
                    "zh": zh,
                    "en": en,
                    "note": note,
                    "category": cat_name,
                }
            )
    else:
        for line in raw_text.splitlines():
            line = line.strip()
            if not line:
                continue
            parts = [p.strip() for p in line.split("|")]
            while len(parts) < 5:
                parts.append("")
            jp_raw, zh, en, kana_in, note = parts[0], parts[1], parts[2], parts[3], parts[4]
            if not (jp_raw or zh or en):
                continue
            jp, auto_kana = split_jp_kana(jp_raw)
            items.append(
                {
                    "jp": jp,
                    "kana": kana_in or auto_kana,
                    "zh": zh,
                    "en": en,
                    "note": note,
                    "category": cat_name,
                }
            )
    return items


# ---------- HTTP Request / Response Helpers ----------
def set_header(name, value):
    try:
        response.headers[name] = value
    except Exception:
        pass


def send_json(data, status=200):
    try:
        response.status_code = status
    except Exception:
        pass
    set_header("Content-Type", "application/json; charset=utf-8")
    set_header("Cache-Control", "no-store")
    print(json.dumps(data, ensure_ascii=False))


def send_tsv(tsv_text):
    try:
        response.status_code = 200
    except Exception:
        pass
    set_header("Content-Type", "text/tab-separated-values; charset=utf-8")
    set_header("Content-Disposition", 'attachment; filename="kotonote-terms.tsv"')
    set_header("Cache-Control", "no-store")
    print(tsv_text)


def get_json_body():
    try:
        data = request.get_json(silent=True)
        if isinstance(data, dict):
            return data
    except TypeError:
        try:
            data = request.get_json()
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    except Exception:
        pass

    for attr in ("json", "data"):
        try:
            val = getattr(request, attr, None)
            if isinstance(val, dict):
                return val
            if isinstance(val, (bytes, bytearray)):
                val = val.decode("utf-8", errors="ignore")
            if isinstance(val, str) and val.strip():
                parsed = json.loads(val)
                if isinstance(parsed, dict):
                    return parsed
        except Exception:
            pass

    try:
        raw = request.get_data(as_text=True)
        if raw and raw.strip():
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
    except Exception:
        pass

    return {}


def get_action():
    try:
        act = request.args.get("action")
        if act:
            return str(act).strip()
    except Exception:
        pass
    return "health"


# ---------- Action Router ----------
def handle_request():
    action = get_action()

    if action == "health":
        words = load_words()
        send_json(
            {
                "status": "ok",
                "storage": "Retiehe KV Database",
                "database": DB_NAME,
                "wordCount": len(words),
            }
        )
        return

    if action == "bootstrap":
        words = load_words()
        send_json(
            {
                "words": words,
                "categories": compute_categories(words),
                "scratch": load_scratch(),
                "settings": load_settings(),
            }
        )
        return

    if action == "create_word":
        body = get_json_body()
        jp = str(body.get("jp") or "").strip()
        kana = str(body.get("kana") or "").strip()
        zh = str(body.get("zh") or "").strip()
        en = str(body.get("en") or "").strip()
        category = str(body.get("category") or "未分类").strip() or "未分类"
        note = str(body.get("note") or "").strip()
        if not (jp or zh or en):
            send_json({"detail": "日语、中文、英文至少填写一项"}, 400)
            return

        words = load_words()
        meta = load_meta()
        new_id = int(meta.get("nextWordId", len(words) + 1))
        meta["nextWordId"] = new_id + 1
        ts = now_str()
        word = {
            "id": new_id,
            "jp": jp,
            "kana": kana,
            "zh": zh,
            "en": en,
            "category": category,
            "note": note,
            "created_at": ts,
            "updated_at": ts,
            "entries": [],
        }
        words.insert(0, word)
        save_words(words, meta)
        send_json({"word": word, "categories": compute_categories(words)})
        return

    if action == "update_word":
        body = get_json_body()
        word_id = body.get("id")
        if word_id is None:
            send_json({"detail": "缺少词条 id"}, 400)
            return
        words = load_words()
        target = next((w for w in words if int(w.get("id", -1)) == int(word_id)), None)
        if not target:
            send_json({"detail": "词条不存在"}, 404)
            return

        for key in ("jp", "kana", "zh", "en", "category", "note"):
            if key in body and body[key] is not None:
                target[key] = str(body[key]).strip()
        if not target.get("category"):
            target["category"] = "未分类"
        if not (target.get("jp") or target.get("zh") or target.get("en")):
            send_json({"detail": "日语、中文、英文至少保留一项"}, 400)
            return
        target["updated_at"] = now_str()
        save_words(words)
        send_json({"word": target, "categories": compute_categories(words)})
        return

    if action == "delete_word":
        body = get_json_body()
        word_id = body.get("id")
        if word_id is None:
            send_json({"detail": "缺少词条 id"}, 400)
            return
        words = load_words()
        new_words = [w for w in words if int(w.get("id", -1)) != int(word_id)]
        if len(new_words) == len(words):
            send_json({"detail": "词条不存在"}, 404)
            return
        save_words(new_words)
        send_json({"ok": True, "categories": compute_categories(new_words)})
        return

    if action == "batch_import":
        body = get_json_body()
        text = str(body.get("text") or "")
        fmt = str(body.get("format") or "tsv")
        category = str(body.get("category") or "新增术语").strip() or "新增术语"
        items = parse_batch_text(text, fmt=fmt, default_category=category)
        if not items:
            send_json({"detail": "未解析到有效词条，请检查分隔格式"}, 400)
            return

        words = load_words()
        meta = load_meta()
        next_id = int(meta.get("nextWordId", len(words) + 1))
        index_by_key = {(w.get("zh", ""), w.get("jp", "")): w for w in words}
        ts = now_str()
        added = 0
        updated = 0
        skipped = 0
        newly_created = []

        for item in items:
            key = (item["zh"], item["jp"])
            existing = index_by_key.get(key)
            if existing:
                changed = False
                if not existing.get("en") and item["en"]:
                    existing["en"] = item["en"]
                    changed = True
                if not existing.get("kana") and item["kana"]:
                    existing["kana"] = item["kana"]
                    changed = True
                if item["note"] and item["note"] not in existing.get("note", ""):
                    existing["note"] = (existing.get("note", "") + "\n" + item["note"]).strip()
                    changed = True
                if changed:
                    existing["updated_at"] = ts
                    updated += 1
                else:
                    skipped += 1
            else:
                new_word = {
                    "id": next_id,
                    "jp": item["jp"],
                    "kana": item["kana"],
                    "zh": item["zh"],
                    "en": item["en"],
                    "category": item["category"],
                    "note": item["note"],
                    "created_at": ts,
                    "updated_at": ts,
                    "entries": [],
                }
                next_id += 1
                newly_created.append(new_word)
                index_by_key[key] = new_word
                added += 1

        if newly_created:
            words = list(reversed(newly_created)) + words
        meta["nextWordId"] = next_id
        save_words(words, meta)
        send_json(
            {
                "stats": {"added": added, "updated": updated, "skipped": skipped},
                "words": words,
                "categories": compute_categories(words),
            }
        )
        return

    if action == "add_word_entry":
        body = get_json_body()
        word_id = body.get("wordId")
        content = str(body.get("content") or "").strip()
        if word_id is None or not content:
            send_json({"detail": "便签内容不能为空"}, 400)
            return
        words = load_words()
        target = next((w for w in words if int(w.get("id", -1)) == int(word_id)), None)
        if not target:
            send_json({"detail": "词条不存在"}, 404)
            return
        meta = load_meta()
        eid = int(meta.get("nextEntryId", 1))
        meta["nextEntryId"] = eid + 1
        entry = {"id": eid, "text": content, "time": short_stamp()}
        entries = target.get("entries")
        if not isinstance(entries, list):
            entries = []
        entries.insert(0, entry)
        target["entries"] = entries
        target["updated_at"] = now_str()
        save_words(words, meta)
        send_json({"entry": entry, "word": target})
        return

    if action == "delete_word_entry":
        body = get_json_body()
        word_id = body.get("wordId")
        entry_id = body.get("entryId")
        if word_id is None or entry_id is None:
            send_json({"detail": "参数缺失"}, 400)
            return
        words = load_words()
        target = next((w for w in words if int(w.get("id", -1)) == int(word_id)), None)
        if not target:
            send_json({"detail": "词条不存在"}, 404)
            return
        target["entries"] = [e for e in (target.get("entries") or []) if int(e.get("id", -1)) != int(entry_id)]
        save_words(words)
        send_json({"ok": True})
        return

    if action == "save_scratch":
        body = get_json_body()
        sc = load_scratch()
        sc["text"] = str(body.get("content") or "")
        save_scratch(sc)
        send_json({"scratch": sc})
        return

    if action == "add_scratch_entry":
        body = get_json_body()
        content = str(body.get("content") or "").strip()
        if not content:
            send_json({"detail": "随手记内容不能为空"}, 400)
            return
        sc = load_scratch()
        meta = load_meta()
        eid = int(meta.get("nextEntryId", 1))
        meta["nextEntryId"] = eid + 1
        save_meta(meta)
        entry = {"id": eid, "text": content, "time": short_stamp()}
        sc["entries"].insert(0, entry)
        save_scratch(sc)
        send_json({"entry": entry, "scratch": sc})
        return

    if action == "delete_scratch_entry":
        body = get_json_body()
        entry_id = body.get("entryId")
        if entry_id is None:
            send_json({"detail": "参数缺失"}, 400)
            return
        sc = load_scratch()
        sc["entries"] = [e for e in sc["entries"] if int(e.get("id", -1)) != int(entry_id)]
        save_scratch(sc)
        send_json({"ok": True})
        return

    if action == "update_settings":
        body = get_json_body()
        settings = save_settings(body)
        send_json({"settings": settings})
        return

    if action == "export_json":
        words = load_words()
        set_header("Content-Disposition", 'attachment; filename="kotonote-backup.json"')
        send_json(
            {
                "app": "KotoNote",
                "version": 2,
                "storage": "Retiehe KV Database",
                "exportedAt": now_str(),
                "words": words,
                "scratch": load_scratch(),
                "settings": load_settings(),
            }
        )
        return

    if action == "export_tsv":
        words = list(reversed(load_words()))
        rows = []
        for w in words:
            jp = w.get("jp", "")
            kana = w.get("kana", "")
            jp_full = jp + "（" + kana + "）" if kana and kana not in jp else jp
            rows.append([w.get("zh", ""), w.get("en", ""), jp_full, w.get("note", ""), w.get("category", "")])
        send_tsv(build_tsv_text(["中文", "English", "日本語", "备注", "分类"], rows))
        return

    if action == "import_json":
        body = get_json_body()
        payload = body.get("payload")
        replace = bool(body.get("replace", False))
        if not isinstance(payload, dict) or not isinstance(payload.get("words"), list):
            send_json({"detail": "备份 JSON 格式无效（缺少 words 列表）"}, 400)
            return

        words = [] if replace else load_words()
        meta = load_meta()
        next_wid = 1 if replace else int(meta.get("nextWordId", len(words) + 1))
        next_eid = 1 if replace else int(meta.get("nextEntryId", 1))
        index_by_key = {(w.get("zh", ""), w.get("jp", "")): w for w in words}
        ts = now_str()
        added = 0
        updated = 0
        newly_created = []

        for w in reversed(payload["words"]):
            jp = str(w.get("jp") or "").strip()
            kana = str(w.get("kana") or "").strip()
            zh = str(w.get("zh") or "").strip()
            en = str(w.get("en") or "").strip()
            cat = str(w.get("category") or "未分类").strip() or "未分类"
            note = str(w.get("note") or "").strip()
            if not (jp or zh or en):
                continue

            raw_entries = w.get("entries") if isinstance(w.get("entries"), list) else []
            key = (zh, jp)
            existing = None if replace else index_by_key.get(key)
            if existing:
                existing["kana"] = kana or existing.get("kana", "")
                existing["en"] = en or existing.get("en", "")
                existing["category"] = cat
                existing["note"] = note or existing.get("note", "")
                existing["updated_at"] = ts
                ex_texts = {e.get("text") for e in (existing.get("entries") or [])}
                for re_item in reversed(raw_entries):
                    t = str(re_item.get("text") or "").strip()
                    if t and t not in ex_texts:
                        existing.setdefault("entries", []).insert(
                            0, {"id": next_eid, "text": t, "time": str(re_item.get("time") or short_stamp())}
                        )
                        next_eid += 1
                        ex_texts.add(t)
                updated += 1
            else:
                norm_entries = []
                for re_item in raw_entries:
                    t = str(re_item.get("text") or "").strip()
                    if t:
                        norm_entries.append(
                            {"id": next_eid, "text": t, "time": str(re_item.get("time") or short_stamp())}
                        )
                        next_eid += 1
                nw = {
                    "id": next_wid,
                    "jp": jp,
                    "kana": kana,
                    "zh": zh,
                    "en": en,
                    "category": cat,
                    "note": note,
                    "created_at": str(w.get("created_at") or ts),
                    "updated_at": ts,
                    "entries": norm_entries,
                }
                next_wid += 1
                newly_created.append(nw)
                index_by_key[key] = nw
                added += 1

        if newly_created:
            words = list(reversed(newly_created)) + words
        meta["nextWordId"] = next_wid
        meta["nextEntryId"] = next_eid
        save_words(words, meta)

        sc = load_scratch()
        in_sc = payload.get("scratch")
        if isinstance(in_sc, dict):
            if in_sc.get("text"):
                sc["text"] = str(in_sc["text"])
            if isinstance(in_sc.get("entries"), list):
                ex_sc_texts = {e.get("text") for e in sc["entries"]}
                for se in reversed(in_sc["entries"]):
                    t = str(se.get("text") or "").strip()
                    if t and t not in ex_sc_texts:
                        sc["entries"].insert(
                            0, {"id": next_eid, "text": t, "time": str(se.get("time") or short_stamp())}
                        )
                        next_eid += 1
                        ex_sc_texts.add(t)
                meta["nextEntryId"] = next_eid
                save_meta(meta)
            save_scratch(sc)

        send_json(
            {
                "stats": {"added": added, "updated": updated},
                "words": words,
                "categories": compute_categories(words),
                "scratch": sc,
            }
        )
        return

    send_json({"detail": "未知操作: " + str(action)}, 404)


try:
    handle_request()
except Exception as exc:
    send_json({"detail": "云函数执行异常: " + str(exc)}, 500)
