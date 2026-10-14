# script.user.js 问题记录

记录对本脚本（fork 自 Greasy Fork #430918 / [ZiuChen/userscript](https://github.com/ZiuChen/userscript)）的历次审查结果与当前处理状态。
**加新条目时请一并标注状态和涉及提交**，避免后来者对着已修复的问题重复劳动。

状态说明：`已修复` / `部分修复` / `未处理`（未处理项在文末"仍待处理"一节汇总）。
回归验证：`node test/run-tests.js`（无第三方依赖，覆盖周次解析、时间计算、ICS 事件生成、CSV 生成）。

- 第一轮审查（fork 前）：提交 `f0edf4c` 记录，`5ffb4a5` 集中修复。
- 第二轮审查：提交 `f0edf4c` 之后复读代码发现，随 v1.6.1 修复。

---

## 第一轮审查（原始 8 条）

### 1. 延时教学楼时间判断逻辑错误 —— 已修复

原实现用 `for...of` 遍历 `["思源西楼", "逸夫"]`，每轮迭代都无条件走 `if` 或 `else`，后一次赋值覆盖前一次，最终只有数组最后一个元素（"逸夫"）生效，"思源西楼"的课永远按标准时间导出。

**现状**：`timeConstructor()` 改为先对教学楼列表做 `.some()` 判断一次再选时间表（现为 `DELAY_CLASSROOMS` / `DELAY_TIME_TABLE` 两个常量）。`test/run-tests.js` 已覆盖思源西楼、逸夫两个分支。

### 2. 默认起始周一写死为 2022-08-29 —— 部分修复

`defaultStartMonday = "2022-08-29"` 对应 2022 年秋季学期，新用户若没手动改，导出的日期会整体错位且毫无提示。

**现状**：`5ffb4a5` 起，日期主要来自自动抓取的校历数据，"起始周一"退化为抓取失败时的兜底；v1.6.1 又补了一条保护——**线性回退且该日期距今天超过半年时弹窗明确警告**，提示用户刷新校历或填写本学期第一个教学周的周一。仍未做的是自动推断当前学期起始周（见"仍待处理"）。

### 3. CSV 表头时间显示错误 —— 已修复

`charArr[i] + " [" + standardTimeTable[i][0] + " - " + standardTimeTable[i][0] + "]"` 两处都取了开始时间，导出形如 `08:00 - 08:00`。

**现状**：改为 `[i][0] - [i][1]`。

### 4. CSV 导出没有转义特殊字符 —— 已修复

课程名/地点含英文逗号或双引号时列会错位。

**现状**：新增 `csvEscape()`，含 `"`、`,`、换行的字段整体加引号、内部双引号转义为两个双引号。

### 5. "重置"按钮清空整个域的 localStorage —— 已修复

`localStorage.clear()` 会连带删除教务系统自己存的数据。

**现状**：改为遍历 `OWNED_STORAGE_KEYS`（`defaultStartMonday`、`selectedSemesterId`、`semesterCalendarCache`）逐个 `removeItem`。

### 6. tableTransfer 的 isOrigin=true 分支是错误死代码 —— 已修复

该分支会把 7 天数据全部覆盖成第一天，虽然当时无人传 `isOrigin`。

**现状**：参数与分支已整体删除。

### 7. dateStr2Arr 单双周解析依赖精确分隔符 —— 已修复（并扩展）

原来依赖 `", "`（逗号+空格）精确匹配，页面格式一变就产生 `NaN` 周次。

**现状**：改为正则匹配 `[-－]` / `[,，、]`，无法解析的项会 `console.warn` 并跳过；v1.6.1 进一步支持了尾部单双周标记（见第二轮第 14 条）。

### 8. 教学周日期计算没有考虑校历中的整周放假 —— 已修复

线性公式 `第 N 教学周 = 起始周一 + 7×(N-1) 天` 无法表达"假期周不计入教学周编号"，一旦出现跳周，后半学期所有日期整体偏移 7 天的倍数，且没有任何提示。

**现状**：`5ffb4a5` 改为通过 `GM_xmlhttpRequest` 抓取校历页（`SemesterTranPage.aspx` 内嵌的 `#hidJson`），用学校自己的"第 N 教学周 → 该周周一"映射生成日期表，放假周天然被跳过；UI 上新增学期下拉框与"刷新校历"按钮，失败时才回退到线性推算并给出警告。

---

## 第二轮审查（发现于 `5ffb4a5` 之后，v1.6.1 修复）

### 9. 教学周不在日期表里时整个导出崩溃 —— 已修复

`timeConstructor()` 里 `new Date(weekTable[weekTh][weekNum - 1])` 没有越界检查。选错学期、课程周次超出校历数据时抛 `TypeError`，而按钮回调没有 `try/catch`，用户看到的现象是"点了导出没反应"。

**现状**：越界时返回 `null`，`eventConstructor()` 跳过该条并统计，导出完成后提示"另有 N 条课程因所在教学周不在校历数据中而被跳过"。

### 10. location 为 undefined 时崩溃 —— 已修复

`isDelay.search(item)` 对 `undefined` 会抛错。地点是从按索引取的 DOM 节点读的，取不到时就会触发。

**现状**：`locationStr == null ? "" : String(locationStr)` 兜底，并按标准时间处理。

### 11. 导出失败静默无提示 —— 已修复

三个导出按钮的回调没有任何异常处理；ICS 路径抛错发生在 Promise 链里，属于 unhandled rejection，界面上完全没有反馈。

**现状**：新增 `runExport(label, fn)` 统一 `try/catch` 并处理 Promise 拒绝，失败时 `alert` 出具体原因；`icsmain()` 改为返回 Promise。另外三个导出入口都会在"一条课程都没解析到"时明确提示。

### 12. 校历缓存损坏会让整排按钮消失 —— 已修复

`JSON.parse(localStorage.getItem("semesterCalendarCache"))` 未做容错，`bindEvents()` 内抛错会导致 UI 注入中断。

**现状**：新增 `readCalendarCache()`，结构异常或解析失败时 `console.warn`、丢弃缓存并继续，不再影响脚本其余部分。

### 13. CSV 周日课程被写进名为 "undefined" 的列 —— 已修复

`toExcelFormatter()` 每行只有 `column1~column7` 七个键，填充时用 `objKeys[j + 1]` 遍历 `j = 0..6`，`j = 6`（周日）取到 `objKeys[7] === undefined`，数据被写进字面量键 `"undefined"`。实测该行会多出第 9 个字段、内容以 `undefined` 开头。另外旧实现在每行末尾都会多拼一个逗号，Excel 中表现为多一个空列。

**现状**：改为 `column1~column8`（节次标签 + 周一~周日）；`buildCsvString()` 用 `join(",")` 拼行，不再有行尾逗号。表头与数据行的列数均已对齐。

### 14. 单双周后缀被 substring 截掉 —— 已修复

`dateStr.substring(dateStr.indexOf("第") + 1, dateStr.indexOf("周"))` 会把 `第1-16周(单)` 截成 `1-16`，单双周标记被丢弃，导出成每周都有课；`initInfo` 里也丢了该信息。

**现状**：新增 `parseWeekSpec()`，识别单/双周标记并按奇偶过滤周次（同时支持 `(单)`、`（双周）`、缺少"第…周"包裹等写法），`initInfo` 保留标记。**注意**：教务页面是否真的会出现这种写法尚未在真实页面确认，但由于只在检测到"单/双"字样时才过滤，对已确认的 `第03-06周` 格式无影响。

### 15. 单元格各字段数量不齐时整体抛错 —— 已修复

两个课表解析函数按同一个索引 `k` 去取课程名/地点/周次/教师，并反复调用 `querySelectorAll`；页面结构稍有出入就会 `TypeError`。

**现状**：改为先缓存节点列表、逐一判空，结构不符时 `console.warn` 并跳过该条；同时补上了 `scheduleGetTable()` 中 `innerText.split("\n")[1]` 可能为 `undefined` 的兜底。

---

## 仍待处理

以下问题已确认存在，但不是明显的代码笔误，需要先做产品/格式决策或拿到真实页面样本。

- **A. CSV 行标签的时间与错峰教室不符**：`toExcelFormatter()` 的行标签固定使用 `STANDARD_TIME_TABLE`，思源西楼/逸夫课程的实际时间与之不同（ICS 导出是正确的）。CSV 是一张"周视图"表格，行=节次、列=星期，而错峰时间是按教室决定的，单个行标签无法同时表达两种时间。可选方案：单元格内附加实际时间、或行标签同时列出两套时间。
- **B. 校历抓取依赖页面结构且缺少格式校验**：`#hidJson` / `#ddlSemTitle` 任一改动都会失效（目前只给出"校历页面结构已变化"的通用报错）；`col.DT` 用 `/\d+/` 取第一个数字串，隐含假定为 `/Date(毫秒)/` 形式，若校历改成 `"2026-08-31"` 这类字符串会被解析成 2026 毫秒。建议增加格式断言。
- **C. 错峰上课时间硬编码**：`DELAY_CLASSROOMS` / `DELAY_TIME_TABLE` 需要改源码，而教务处每学期调整（对应 `todo.md` 第 1 条）。
- **D. 校历中的放假信息没有被利用**：放假周只是在"第 N 周对应哪几天"层面被跳过，既不生成放假全天事件，也不提示哪几周放假（对应 `todo.md` 第 2 条）。
- **E. 更新地址指向上游**：`@downloadURL` / `@updateURL` 仍为上游 Greasy Fork #430918。本 fork 版本号更高（1.6.1 > 1.5.1）暂时不会被覆盖，但一旦上游发布更高版本，脚本管理器会拉取上游版本并丢掉本 fork 的修复。
- **F. DOM 选择器未在真实页面复测**：`tr>td[style!='height:80px;']`、`span[style="color:#000"]`、`div[style="max-width:120px;"]`、`getElementsByTagName("span")[k*3]` 都强依赖页面内联样式与节点顺序，改动后需要在"本学期课表"与"选课课表"两个页面各实测一次。
