// 驾驶舱分仪表讲解 + 舱内标注点（标注集 'cockpit'：镜头位于驾驶舱内时自动启用）
// 资料来源：
//   默认显示布局（外侧 PFD、机长内侧屏 ND + EICAS、下中央屏双 CDU，6 个 MFD 窗口）：
//     https://www.allairplaneflying.com/2024/04/boeing-787-display-selection-and.html
//     https://www.airliners.net/forum/viewtopic.php?t=770261
//   PFD 小地图与 AUX：https://rosap.ntl.bts.gov/view/dot/77507/dot_77507_DS1.pdf
//                     https://www.allairplaneflying.com/2024/04/boeing-787-clocks-boeing-787-full-pilot.html
//   5 块 15.1 in、可视区 12 × 9.1 in、显示面积为 777 的两倍多：https://secure.boeingimages.com/archive/787-Dreamliner-Flight-Deck--2F3XC5KG07X.html
//                                                           https://www.theengineer.co.uk/content/news/flight-deck
//   双 HUD 标配、业界首次、罗克韦尔柯林斯：https://www.aviationtoday.com/2005/06/01/boeing-787-integrations-next-step/
//   襟翼卡位：https://kb.skyhightex.com/knowledge-base/flight-control-summary/
//             787-8 七档（ATSB 2017）：https://asn.flightsafety.org/reports/2017/20170513_B788_VH-VKA.pdf
//   EFB（787 标配双安装式、XFR 互看）：https://www.flightglobal.com/boeing-widens-efb-beyond-777s/62895.article
//                                     https://fsims.faa.gov/wdocs/fsb/efb_bp4_fsb_rev-1.htm
//                                     https://www.boeing.com/commercial/787/by-design
//   双舵柄标配、线传前轮转弯：https://www.pprune.org/archive/index.php/t-568841.html
//                             https://www.airliners.net/forum/viewtopic.php?t=1437313
//   电刹车：https://www.safran-group.com/products-services/boeing-787-dreamliner-electric-brake
//   起落架手柄轮形握把：14 CFR 25.781；备用磁罗盘：14 CFR 25.1303(a)(3)
import { FD_EYE } from '../model/flightdeck.js';

const [EX, EY, EZ] = FD_EYE;
/** 聚焦时的观察眼位：L 机长、R 副驾驶、C 中央前探、O 观察员座椅 */
export const FD_VIEWS = { L: [EX, EY, EZ], R: [EX, EY, -EZ], C: [3.0, 5.8, 0], O: [3.5, 5.9, 0] };
/** 驾驶舱后隔板站位：镜头在此之前时启用 'cockpit' 标注集 */
export const FD_AFT = 4.6;

export const FD_PARTS = {
  fdPfd: {
    name: '主飞行显示（PFD）', en: 'Primary Flight Display', cat: 'cockpit',
    summary: '外侧显示器的主体：姿态、空速、高度、航向和自动飞行模式。',
    body: '主飞行显示（PFD）占据每位飞行员正前方外侧显示器的大部分。中间是蓝天棕地的姿态仪，左侧是空速带，右侧是高度带和升降速度，底部是航向刻度，787 的 PFD 底部还带一幅俯视小地图，显示前方航路。最上面一行是飞行方式通告（FMA），从左到右显示自动油门、横向、纵向当前的工作模式。图中是巡航状态示意：马赫 0.85、高度 37,000 ft、航向 285°，自动驾驶接通，横向 LNAV、纵向 VNAV PTH。',
    facts: [['位置', '两侧外侧显示器（靠内约 2/3）'], ['主要内容', '姿态、空速、高度、升降速度、航向、FMA'], ['屏幕', '15.1 in，可视区约 12 × 9.1 in'], ['图中状态', 'M.850 · FL370 · HDG 285']],
  },
  fdAux: {
    name: '辅助显示（AUX）', en: 'Auxiliary Display', cat: 'cockpit',
    summary: '外侧显示器靠外的一窄条：时钟、航班信息和 ATC 数据链。',
    body: '每块外侧显示器靠外的约 1/3 是辅助显示（AUX）。上半部是航班数据块：航班号、应答机编码、UTC 时间和日期、飞行时间等，时钟由 GPS 自动授时，飞行计时在离地时自动开始；下半部是空中交通管制（ATC）数据链区，显示管制员通过 CPDLC 发来的文字指令。机长的 AUX 在 PFD 左边，副驾驶的在右边，都朝向外侧。',
    facts: [['位置', '外侧显示器靠外约 1/3'], ['上部', '航班数据块、时钟'], ['下部', 'ATC 数据链（CPDLC）'], ['时钟', 'GPS 授时，离地自动计时']],
  },
  fdNd: {
    name: '导航显示（ND）', en: 'Navigation Display', cat: 'cockpit',
    summary: '随飞机航向转动的电子地图：计划航路、气象、地形和周边交通。',
    body: '导航显示（ND）是一张以本机为中心、随航向转动的电子地图。品红色折线是飞行管理计算机（FMC）里的计划航路，星形符号是航路点，还可以叠加气象雷达回波、地形和周边交通（TCAS）；787 的 ND 下方还能打开垂直状态显示（VSD），用侧视剖面显示前方地形和下降路径。开机默认布局是机长内侧屏左半显示 ND，副驾驶内侧屏整屏显示 ND。图中下一个航路点是 126 海里外的 OMBAX，左下角是一架比本机高 1000 ft 的飞机。',
    facts: [['默认位置', '机长内侧屏左半 / 副驾驶内侧屏'], ['叠加图层', '气象雷达、地形、交通（TCAS）'], ['垂直剖面', 'VSD（垂直状态显示）'], ['控制', '遮光罩两端的 EFIS 控制板']],
  },
  fdEicas: {
    name: '发动机指示与机组告警（EICAS）', en: 'EICAS', cat: 'cockpit',
    summary: '两台发动机的推力、温度等参数和机组告警信息，始终占据一个显示窗口。',
    body: 'EICAS 上方是两台发动机的主参数：风扇转速 N1（衡量推力的主要指标）和排气温度 EGT；下面是 N2、燃油流量、滑油压力和温度、振动，以及总燃油量。告警信息按严重程度分为红色警告、琥珀色戒备和琥珀色缩进的提示。787 的两块内侧屏和下中央屏在软件上各分成左右两个窗口，共 6 个，EICAS 必须一直占用其中一个：正常时在机长内侧屏的右半边或副驾驶内侧屏的左半边。',
    facts: [['默认位置', '机长内侧屏右半'], ['主参数', 'N1、EGT'], ['次要参数', 'N2、燃油流量、滑油、振动'], ['告警分级', '警告（红）· 戒备（琥珀）· 提示（琥珀缩进）']],
  },
  fdSyn: {
    name: '多功能窗口：电源简图', en: 'MFD · Electrical Synoptic', cat: 'cockpit',
    summary: '787 的显示窗口由机组自选内容，这里副驾驶调出了电源系统简图。',
    body: '内侧屏和下中央屏上的多功能窗口（MFD）可以显示导航（ND）、系统简图（SYS）、电子检查单（CHKL）、飞行管理（CDU）、信息（INFO）或通信（COMM）页面。图中副驾驶把内侧屏左半调成了电源系统简图：每台发动机带两台 250 kVA 变频起动发电机（VFSG），电能先进入 235 V 交流汇流条，经自耦变压整流器（ATRU）变成 ±270 V 直流供大功率电机，再经变压整流器（TRU）得到 28 V 直流；巡航中两台 APU 起动发电机关闭。',
    facts: [['可选格式', 'ND · SYS · CHKL · CDU · INFO · COMM'], ['发动机发电机', '4 × 250 kVA VFSG'], ['APU 发电机', '2 × 225 kVA（图中关闭）'], ['电压等级', '235 VAC · ±270 VDC · 28 VDC']],
  },
  fdLower: {
    name: '下中央显示器', en: 'Lower Center Display', cat: 'cockpit',
    summary: '第 5 块 15.1 in 屏，默认左右两个窗口各显示一个 CDU 页面。',
    body: '前操纵台最前端斜放着第 5 块 15.1 in 显示器。它也分成左右两个窗口，开机默认各显示一个控制显示组件（CDU）页面，左边归机长、右边归副驾驶。787 没有传统那种带实体键盘的 CDU，飞行管理计算机的页面直接显示在屏幕上，用中央操纵台上的多功能键盘（MFK）输入字母和数字，用光标控制器（CCD）点选。图中左窗是航段（LEGS）页，右窗是进度（PROGRESS）页。',
    facts: [['默认内容', '左右各一个 CDU 页面'], ['输入方式', '多功能键盘 MFK + 光标控制器 CCD'], ['图中', '左：LEGS 页 · 右：PROGRESS 页']],
  },
  fdMcp: {
    name: '模式控制面板（MCP）', en: 'Mode Control Panel', cat: 'cockpit',
    summary: '遮光罩中间的长条面板：设定自动驾驶和自动油门的目标与方式。',
    body: '模式控制面板是自动驾驶仪和自动油门的“遥控器”。飞行员在这里设定目标速度（IAS/MACH）、航向或航迹（HDG/TRK）、升降速度或航迹角（V/S FPA）和高度（ALTITUDE），再按键选择 LNAV、VNAV、FLCH、LOC、APP 等方式。两端的 A/P 键接通自动驾驶，F/D 电门打开飞行指引，A/T ARM 电门预位自动油门。所选目标会用品红色同步显示在 PFD 上。图中设定：马赫 0.85、航向 285°、高度 37,000 ft。',
    facts: [['位置', '遮光罩正中'], ['目标窗口', '速度 · 航向/航迹 · 升降速度 · 高度'], ['方式键', 'LNAV · VNAV · FLCH · LOC · APP'], ['两端', 'EFIS 控制板与显示选择板']],
  },
  fdEfis: {
    name: 'EFIS 控制板与显示选择板', en: 'EFIS Control & Display Select Panels', cat: 'cockpit',
    summary: '遮光罩两端各一套：设定气压基准和最低标准，并给各显示窗口分配内容。',
    body: '每位飞行员面前的遮光罩外端各有一套面板。EFIS 控制板上的 MINS 旋钮设定决断高度或最低下降高度，BARO 旋钮设定高度表气压基准（按下 STD 为标准气压），中间的按键选择在 ND 上叠加气象雷达、机场、航路点、地形和交通等图层。旁边的显示选择板（DSP）用来分配窗口内容：先选一块屏（左内侧、下中央、右内侧），再按格式键，把 SYS、CDU、INFO、CHKL、COMM 或 ND 放进去。',
    facts: [['旋钮', 'MINS 最低标准 · BARO 气压基准'], ['ND 图层', 'WXR · ARPT · WPT · TERR · TFC 等'], ['显示选择', 'L INBD · LWR CTR · R INBD'], ['格式键', 'SYS · CDU · INFO · CHKL · COMM · ND']],
  },
  fdHud: {
    name: '平视显示器（HUD）', en: 'Head-Up Display', cat: 'cockpit',
    summary: '两名飞行员前方都标配的透明组合玻璃，飞行数据叠加在外景上。',
    body: '头顶的投影组件把绿色飞行符号投射到飞行员眼前的透明组合玻璃上。符号经过准直，看上去像在远处，飞行员看跑道和外景时不用低头，也不用重新对焦，低能见度进近和着陆时尤其有用。波音称，787 把双 HUD 列为标准装备是业界首次。HUD 由罗克韦尔柯林斯（今 Collins 宇航）提供，与主显示系统集成。组合玻璃不用时可以向上收起。',
    facts: [['配置', '左右各一套，标准装备'], ['组成', '头顶投影组件 + 组合玻璃'], ['供应商', '罗克韦尔柯林斯（今 Collins 宇航）'], ['图中符号', '速度 271 kt · 高度 37000 · 航向 285']],
  },
  fdThrust: {
    name: '油门杆', en: 'Thrust Levers', cat: 'cockpit',
    summary: '两根推力手柄分别控制左右发动机，前侧背着反推手柄。',
    body: '两根推力手柄分别对应左、右发动机。手柄前侧“骑”着反推手柄，只有推力手柄在慢车位时才能拉起；手柄上有起飞/复飞（TO/GA）电门，侧面有自动油门断开电门。787 的发动机由全权限数字电子控制（FADEC）管理，手柄只给出推力指令，燃油流量由 FADEC 计算。自动油门工作时，伺服电机会带着手柄移动，飞行员看手柄位置就知道推力在怎样变化。图中两根手柄在巡航推力位置。',
    facts: [['数量', '2 根（左、右发动机）'], ['电门', 'TO/GA、自动油门断开'], ['反推', '骑背式反推手柄，慢车位才能拉起'], ['发动机控制', 'FADEC']],
  },
  fdSpeedbrake: {
    name: '减速板手柄', en: 'Speedbrake Lever', cat: 'cockpit',
    summary: '控制机翼上的扰流板：空中减速，着陆后自动升起卸除升力。',
    body: '中央操纵台左侧的手柄控制扰流板。空中向后拉，两侧机翼上表面的扰流板同时升起，增加阻力，帮助减速和下降；进近时放在 ARMED（预位），主轮接地后扰流板会自动全部升起，破坏机翼升力，让飞机重量压到机轮上，提高刹车效率。787 每侧机翼有 7 块扰流板，其中 2 对由电动机械作动器驱动。图中手柄在 DOWN（收起）位。',
    facts: [['位置', '中央操纵台左侧'], ['卡位', 'DOWN · ARMED · FLIGHT · UP'], ['扰流板', '每侧 7 块'], ['图中', 'DOWN（收起）']],
  },
  fdFlap: {
    name: '襟翼手柄', en: 'Flap Lever', cat: 'cockpit',
    summary: '选择缝翼和襟翼位置，按培训资料手柄共有 10 个卡位。',
    body: '中央操纵台右侧的手柄选择缝翼和襟翼的位置，越往后拉放得越多。按 787 系统培训资料，卡位为 UP、1、5、10、15、17、18、20、25、30：起飞用 5～20，正常着陆用 25 或 30；卡位 1 只放出前缘缝翼，后缘襟翼仍然收起。20 处设有止动卡槽，防止复飞收襟翼时一下收过头。澳大利亚运输安全局 2017 年的一份事件报告里，787-8 的襟翼位置只有 0、1、5、15、20、25、30 七档。图中手柄在 UP（收起）位。',
    facts: [['卡位', 'UP · 1 · 5 · 10 · 15 · 17 · 18 · 20 · 25 · 30'], ['起飞', '5～20'], ['着陆', '25 或 30'], ['787-8（ATSB 报告）', '7 档：0/1/5/15/20/25/30']],
  },
  fdFuelSw: {
    name: '燃油控制电门', en: 'Fuel Control Switches', cat: 'cockpit',
    summary: '油门台后方的两个电门：RUN 供油，CUTOFF 断油，是起动和关车的总开关。',
    body: '两个燃油控制电门分别控制左、右发动机：起动时放到 RUN，开始向发动机供油；关车时放到 CUTOFF，切断燃油。电门带锁定机构，必须先向外拔出才能扳动，以防误碰。它们位于油门杆后方、中央操纵台的中线上，两名飞行员都够得着。',
    facts: [['数量', '2 个（左、右发动机）'], ['位置', '油门台后方、中线上'], ['位置名', 'RUN / CUTOFF'], ['防误动', '先拔出再扳动']],
  },
  fdKeypad: {
    name: '多功能键盘与调谐面板', en: 'MFK · TCP · CCD', cat: 'cockpit',
    summary: '中央操纵台两侧各一套：键盘输入、无线电调谐和光标控制。',
    body: '中央操纵台两侧为两名飞行员各配一套输入设备。多功能键盘（MFK）用来向 CDU 等页面输入字母和数字；调谐控制面板（TCP）选择甚高频、高频、卫星通信频率和应答机编码；最靠后的光标控制器（CCD）用起来像笔记本电脑的触控板，可以在各显示窗口之间移动光标、点选页面上的按钮。',
    facts: [['MFK', '字母数字键盘'], ['TCP', '无线电与应答机调谐'], ['CCD', '触控板式光标控制器'], ['配置', '左右各一套']],
  },
  fdYoke: {
    name: '驾驶盘与驾驶杆', en: 'Control Wheel & Column', cat: 'cockpit',
    summary: '电传飞控，但保留了传统的驾驶盘，没有用侧杆。',
    body: '787 采用电传飞控：驾驶盘和驾驶杆的位移变成电信号送给飞控计算机，再由计算机指挥作动器偏转舵面。但波音保留了传统的驾驶盘和驾驶杆，没有改用侧杆。两侧驾驶盘相互联动，自动驾驶工作时也会跟着动，飞行员用眼睛和手就能感知飞机正在做什么。盘上有自动驾驶断开按钮、俯仰配平电门和话筒电门，中间夹着检查单卡。',
    facts: [['操纵方式', '电传飞控'], ['驾驶装置', '驾驶盘 + 驾驶杆（非侧杆）'], ['左右联动', '是，自动驾驶时随动'], ['盘上电门', '自动驾驶断开、俯仰配平、话筒']],
  },
  fdOverhead: {
    name: '头顶板', en: 'Overhead Panel', cat: 'cockpit',
    summary: '各系统的控制电门集中在头顶：电源、液压、燃油、空调、防冰、灯光。',
    body: '头顶板集中了飞机各系统的控制电门：飞控、电源、液压、燃油、空调与增压、防冰、发动机起动、风挡加温、氧气和外部灯光等。按波音的“暗驾驶舱”理念，系统正常时电门上的指示灯都不亮，只有需要飞行员注意时才亮起。787 几乎取消了发动机引气，所以空调面板上控制的是电动座舱空气压缩机（CAC），而不是传统的引气阀；液压面板上除了两台发动机泵，还有中央系统的电动泵。',
    facts: [['位置', '两名飞行员头顶'], ['主要面板', '电源、液压、燃油、空调、防冰、灯光'], ['设计理念', '暗驾驶舱：正常时灯不亮'], ['空调气源', '电动座舱空气压缩机（CAC）']],
  },
  fdEfb: {
    name: '电子飞行包（EFB）', en: 'Electronic Flight Bag', cat: 'cockpit',
    summary: '两名飞行员外侧各一块安装式显示器：电子航图、机场地图和性能计算。',
    body: '787 两名飞行员外侧的侧壁上各装有一块电子飞行包（EFB）显示器，用来看电子航图和机场滑行地图、计算起飞和着陆性能、查阅电子手册，替代过去厚重的纸质航图和手册。按 FAA 飞行标准化委员会的报告，两块屏的控制完全相同，按 XFR 键就能显示对方那块屏的画面。波音官网现在的说法是“便携式电子飞行包能力”，不少航空公司也给飞行员配发平板电脑。图中显示的是航路图，品红线是现用航路。',
    facts: [['配置', '左右各一块，装在侧壁上'], ['用途', '电子航图、机场地图、性能计算、电子手册'], ['互看', 'XFR 键显示对方画面'], ['现状', '也支持便携式 EFB']],
  },
  fdTiller: {
    name: '前轮转弯手轮', en: 'Nose Wheel Steering Tiller', cat: 'cockpit',
    summary: '地面滑行转弯用的手轮，787 两名飞行员一侧各有一个。',
    body: '飞机在地面低速滑行时，靠侧操纵台前端的前轮转弯手轮（tiller）转弯，它能让前轮转过很大的角度；方向舵脚蹬也能小角度操纵前轮，用于起飞滑跑时修正方向。787 两名飞行员一侧各有一个手轮，属于标准配置。787 的前轮转弯是线传控制：手轮发出电信号，再由液压作动器转动前轮。',
    facts: [['位置', '侧操纵台前端'], ['配置', '左右各一个'], ['控制方式', '电信号指令、液压驱动'], ['脚蹬', '可小角度操纵前轮']],
  },
  fdIsfd: {
    name: '备用飞行显示（ISFD）', en: 'Integrated Standby Flight Display', cat: 'cockpit',
    summary: '主显示器全部失效时的最后备份：姿态、空速、高度集成在一块小屏上。',
    body: '仪表板上的这块小方屏是集成备用飞行显示（ISFD），把传统的备用姿态仪、空速表和高度表合在一块屏上。它有自己的惯性传感器，从备用全静压系统取得空速和高度，由备用电源供电。即使主显示系统全部失效，飞行员仍能靠它掌握飞机的姿态、速度和高度。',
    facts: [['内容', '姿态、空速、高度、航向'], ['传感器', '内置惯性传感器 + 备用全静压'], ['电源', '备用电源'], ['作用', '主显示失效时的最后备份']],
  },
  fdGear: {
    name: '起落架手柄与自动刹车', en: 'Landing Gear Lever & Autobrake', cat: 'cockpit',
    summary: '轮形握把的起落架收放手柄，下方是自动刹车选择旋钮。',
    body: '起落架手柄的握把做成机轮形状，这是适航规章 25.781 的规定，让飞行员凭手感就能认出它。手柄向上为收起，向下为放下，收放由液压驱动。下方的旋钮选择自动刹车等级：着陆时选 1～4 或 MAX AUTO；起飞前选 RTO（中断起飞），一旦中断起飞就自动全力刹车。赛峰称 787 是第一种采用电刹车的商用飞机，刹车由它提供。图中手柄在 UP（收起）位。',
    facts: [['握把', '轮形（14 CFR 25.781）'], ['收放', '液压驱动'], ['自动刹车', 'RTO · OFF · DISARM · 1–4 · MAX AUTO'], ['刹车', '电刹车（赛峰）']],
  },
  fdSeats: {
    name: '飞行员座椅', en: 'Pilot Seats', cat: 'cockpit',
    summary: '可前后、上下调节，让飞行员的眼睛对准“设计眼位”。',
    body: '机长坐左座，副驾驶坐右座。座椅可以前后、上下调节，起飞前每位飞行员都要把眼睛调到“设计眼位”：从这一点既能看清全部仪表，又能越过遮光罩看到足够多的地面，HUD 符号也按这一点校准。座椅配有五点式安全带（两条肩带、两条腰带和一条胯带汇到中间的旋转锁扣）和可收起的扶手。两座之后的中线上是观察员座椅，本模型的“驾驶舱”视角就设在那里。',
    facts: [['机长', '左座'], ['调节', '前后、上下'], ['安全带', '五点式'], ['观察员座椅', '两座之后的中线上']],
  },
  fdDoor: {
    name: '驾驶舱门', en: 'Flight Deck Door', cat: 'cockpit',
    summary: '加固的防弹、防闯入舱门，平时锁闭。',
    body: '2001 年“9·11”事件后，民航客机的驾驶舱门都改为加固型：门板能抵御枪弹和强行闯入，平时保持锁闭。客舱一侧通过门禁键盘请求进入，由驾驶舱内的飞行员确认后开锁，门上的观察镜可以看清门外的情况。日本 Jamco 在 2025 年的新闻稿中称，它是 787 驾驶舱门和驾驶舱隔墙的唯一供应商。',
    facts: [['类型', '加固型防弹防闯入门'], ['平时', '锁闭'], ['进入', '门禁键盘请求，驾驶舱内确认'], ['供应商（Jamco 2025 年自述）', '787 驾驶舱门与隔墙']],
  },
  fdCompass: {
    name: '备用磁罗盘', en: 'Standby Compass', cat: 'cockpit',
    summary: '挂在风挡中柱顶端的小罗盘，完全不依赖电源的航向参考。',
    body: '挂在两块前风挡之间窗柱顶端的小罗盘，是驾驶舱里最“原始”的仪表：它靠地磁场工作，不需要任何电源和计算机。正常飞行中几乎用不到，但适航规章要求客机必须装备，作为所有电子设备都失效时最后的航向参考。',
    facts: [['位置', '中央窗柱顶端'], ['原理', '地磁'], ['电源', '不需要'], ['依据', '14 CFR 25.1303 要求装备']],
  },
};

// 标注点：body = 机体系 [s, y, z]（锚点放在部件表面前约 1～2 cm）；view = 聚焦眼位；
// prio 2 的标注只在镜头离锚点 near 米以内时出现（例如聚焦到飞行员眼位后），避免观察员视角下标签过密
const near = 1.1;
export const FD_SPOTS = [
  { part: 'fdHud', prio: 1, at: { body: [2.56, 5.715, 0.58] }, view: 'L', off: [-56, -48] },
  { part: 'fdMcp', prio: 1, at: { body: [2.33, 5.441, 0] }, view: 'C', off: [0, -78] },
  { part: 'fdPfd', prio: 1, at: { body: [2.267, 5.222, 0.59] }, view: 'L', off: [-40, -54] },
  { part: 'fdNd', prio: 1, at: { body: [2.27, 5.21, 0.272] }, view: 'L', off: [-16, -50] },
  { part: 'fdEicas', prio: 1, at: { body: [2.27, 5.21, 0.118] }, view: 'C', off: [10, -50] },
  { part: 'fdLower', prio: 1, at: { body: [2.41, 4.984, 0] }, view: 'C', off: [0, 52] },
  { part: 'fdThrust', prio: 1, at: { body: [2.574, 5.178, 0] }, view: 'C', off: [125, -8] }, // 标签放到下中央显示器右侧的暗区，不压屏幕文字
  { part: 'fdYoke', prio: 1, at: { body: [2.52, 5.15, 0.58] }, view: 'C', off: [-30, 56] },
  { part: 'fdEfb', prio: 1, at: { body: [2.525, 5.353, 1.15] }, view: 'L', off: [-20, -48] },
  { part: 'fdOverhead', prio: 1, at: { body: [2.888, 6.168, 0] }, view: 'O', off: [0, 48] },
  { part: 'fdDoor', prio: 1, at: { body: [4.515, 5.8, 0] }, view: 'C', off: [0, -56] },
  { part: 'cockpit', prio: 1, at: { body: [2.13, 5.72, 0.5] }, view: 'L', off: [-30, -40] },
  { part: 'fdSyn', prio: 2, near, at: { body: [2.27, 5.21, -0.118] }, view: 'R', off: [20, -50] },
  { part: 'fdAux', prio: 2, near, at: { body: [2.27, 5.21, 0.743] }, view: 'L', off: [-40, 46] },
  { part: 'fdEfis', prio: 2, near, at: { body: [2.33, 5.441, 0.745] }, view: 'L', off: [-30, -46] },
  { part: 'fdIsfd', prio: 2, near, at: { body: [2.267, 5.25, 0.4175] }, view: 'L', off: [0, 48] },
  { part: 'fdGear', prio: 2, near, at: { body: [2.336, 5.306, -0.4175] }, view: 'R', off: [30, 44] },
  { part: 'fdSpeedbrake', prio: 2, near, at: { body: [2.571, 5.125, 0.157] }, view: 'L', off: [-50, 30] },
  { part: 'fdFlap', prio: 2, near, at: { body: [2.556, 5.125, -0.157] }, view: 'R', off: [50, 30] },
  { part: 'fdFuelSw', prio: 2, near, at: { body: [2.829, 5.04, 0] }, view: 'C', off: [0, 40] },
  { part: 'fdKeypad', prio: 2, near, at: { body: [2.96, 4.996, 0.104] }, view: 'L', off: [-40, 40] },
  { part: 'fdTiller', prio: 2, near, at: { body: [2.74, 5.18, 1.13] }, view: 'L', off: [-30, 40] },
  { part: 'fdSeats', prio: 2, near, at: { body: [3.21, 5.82, 0.58] }, view: 'O', off: [-30, -44] },
  { part: 'fdCompass', prio: 2, near, at: { body: [2.455, 5.99, 0] }, view: 'C', off: [0, -40] },
].map((s) => ({ ...s, set: 'cockpit' }));
