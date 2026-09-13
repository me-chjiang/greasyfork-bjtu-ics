# script.user.js 问题记录

## 1. 延时教学楼时间判断逻辑错误（严重）
`script.user.js:264-286`

```js
let delayClassroom = ["思源西楼", "逸夫"]
for (let item of delayClassroom) {
  if (isDelay.search(item) != -1) {
    // 设置延时时间
  } else {
    // 设置标准时间
  }
}
```

`for...of` 循环每次迭代都会无条件走 if 或 else 分支，后一次迭代会覆盖前一次的赋值，最终结果只由数组最后一个元素的判断决定。地点为"思源西楼"的课程：第一次迭代匹配成功设为延时时间，第二次迭代（`item="逸夫"`）不匹配又被覆盖回标准时间。导致"思源西楼"的课导出时间永远是错的（与实际上课时间差最多 20 分钟），只有"逸夫"能生效。

修复方向：用 `.some()` 判断一次再取表，而不是在循环里逐个覆盖。

## 2. 默认起始周一写死为 2022-08-29（严重）
`script.user.js:20-24`

```js
const defaultStartMonday = "2022-08-29" // 第一个教学周的第一个周一

if (localStorage.getItem("defaultStartMonday") === null) {
  localStorage.setItem("defaultStartMonday", defaultStartMonday)
}
```

这个默认值对应 2022 年秋季学期，脚本当前版本号 1.5.1，早已过了那个学期。新用户第一次使用如果没注意到页面上那个不起眼的输入框、没有手动改成当前学期的开学周一，所有导出的日历/csv/json 日期都会基于错误的起始周计算，整个学期的课程时间全部错位，且没有任何提示或校验起始日期是否"合理"（比如是否离今天太远）。

修复方向：至少应该有一个校验或提示逻辑（比如默认值超过半年就提醒用户检查），或者尝试从页面上的学期信息自动推断当前学期起始周一，而不是长期硬编码一个早已过期的日期。

## 3. CSV 表头时间显示错误
`script.user.js:438-439`

```js
jsonData[i].column1 =
  charArr[i] + " [" + standardTimeTable[i][0] + " - " + standardTimeTable[i][0] + "]"
```

两处都取了 `[i][0]`（开始时间），应该第二处是 `[i][1]`（结束时间）。导出的 csv 第一列显示形如"08:00 - 08:00"的错误区间。

## 4. CSV 导出没有转义特殊字符
`script.user.js:451-464`

```js
str += `${jsonData[i][key] + "\t"},`
```

课程名或地点中如果包含英文逗号、双引号等 CSV 特殊字符，会导致列错位，Excel 打开后数据串行、无法正确解析。

## 5. "重置"按钮清空整个域的 localStorage
`script.user.js:58-61`

```js
$("#restoreSetting").click(() => {
  localStorage.clear()
  location.reload()
})
```

`localStorage.clear()` 会清空 `aa.bjtu.edu.cn` 域下所有的 localStorage，不仅是脚本自己存的 `defaultStartMonday`。如果教务系统本身用 localStorage 存了其他数据（如登录缓存、偏好设置），会被一并误删。应改为 `localStorage.removeItem("defaultStartMonday")`。

## 6. tableTransfer 的 isOrigin=true 分支是错误的死代码
`script.user.js:98-116`

```js
if (isOrigin) {
  for (let j = 0; j < 7; j++) {
    tmpTable.push(rowTable[j])
  }
}
```

当前代码里所有调用都没有传 `isOrigin`（即恒为 falsy），所以这个分支从未被触发。但如果以后有代码传入 `isOrigin=true`，会导致每次外层循环都重复 push 同样的 `rowTable[0..6]`，7 天的数据全部变成第一天的数据。属于潜在隐患，建议删除或修复。

## 7. dateStr2Arr 单双周解析依赖精确分隔符（脆弱）
`script.user.js:135-138`

```js
} else if (dateStr.indexOf(",") != -1) {
  dateArr = dateStr.split(", ")
```

依赖页面上单双周文本严格使用 `", "`（逗号+空格）分隔。如果学校教务系统页面格式微调（比如去掉空格），解析会直接失败，产生 `NaN` 周次。目前未必触发，但比较脆弱。

## 8. 教学周日期计算完全没有考虑校历中的整周放假（架构性问题，严重）
`script.user.js:20`、`script.user.js:70-86`、`script.user.js:260-261`

```js
// script.user.js:70-86
function generateWeekTable() {
  let startMondayString = $("#startMonday").val()
  if (validCheck(startMondayString) === false) return
  const startMonday = new Date(startMondayString)
  let weekDateTable = []
  for (let i = 0; i < 30; i++) {
    let weekArr = []
    for (let j = 0; j < 7; j++) {
      let tmpDate = new Date(startMonday)
      tmpDate.setDate(tmpDate.getDate() + 7 * i + j)
      weekArr.push(tmpDate)
    }
    weekDateTable.push(weekArr)
  }
  return weekDateTable
}
```

```js
// timeConstructor 内部，script.user.js:260-261
let WeekTable = generateWeekTable()
let DayTime = new Date(WeekTable[weekTh - 1][weekNum - 1])
```

`generateWeekTable()` 生成 30 周日期表的方式，是从用户填的"第一个教学周的第一个周一"（`defaultStartMonday`，`script.user.js:20`）开始，纯按 `7 * i` 天做线性偏移。也就是说脚本内置了一个隐藏假设：**教学周 N 的周一 = 起始周一 + 7×(N-1) 天，对第 1 到 30 周全部成立，中间不能有任何"断档"**。

而 `courseTmp.date`（课程所在的教学周编号，如"第03-06周"）是直接从教务系统排课表页面抓下来的教学周编号，这个编号是学校教务系统自己定义的，不一定和"从起始周一开始连续数自然周"完全对应。如果学期中间出现一整周的放假（比如国庆、寒暑假调整等），并且学校的教学周编号在这一周处**不计数**（即放假周不算作一个教学周，导致编号在假期前后出现跳跃：例如第 4 教学周之后紧接着一整周假期，然后"第 5 教学周"实际对应的是从起始周一算起的第 6 个自然周），那么从这个跳跃点开始，`generateWeekTable()` 算出来的所有后续周日期都会整体偏差 7 天的倍数，导致后半学期所有课程导出的日历/csv/json 时间全部错位。

脚本目前**没有任何机制**去检测或处理这种情况：
- 它不解析、也不引用 `sites.txt` 里链接的校历页面（`https://bksy.bjtu.edu.cn/Semester.html`）的实际数据；"校历"按钮（`script.user.js:39-41`）只是简单地 `window.open` 打开这个页面，供用户自己肉眼核对，脚本代码完全不消费这个页面的信息。
- "起始周一"这个设置（`script.user.js:62-66`）是全局唯一的一个日期，只能表达"从哪天开始线性数教学周"，无法表达"学期中间插入了一段不计入教学周编号的整周假期"这种非线性情况。
- 也没有任何校验逻辑去对比"按线性公式推算出的日期"和"当前日期/学期已知节点"是否合理，出现跳周后不会有任何报错或提示，用户很可能完全不会发现导出的日历已经错位。

这是一个架构性的局限，而不是简单的逻辑笔误：只要当前学期校历中出现"整周放假且这周不计入教学周编号"的情况，这个脚本目前的日期计算模型就会失效，且没有兜底手段。
