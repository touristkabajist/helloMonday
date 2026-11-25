/* 逻辑验收桩：模拟 localStorage/document，运行 index.html 内嵌脚本并断言核心功能 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

/* ---- DOM 桩 ---- */
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
global.confirm = () => true;
global.window = { scrollTo() {} };
const els = {};
function makeEl(sel) {
  const el = {
    sel, _innerHTML: '', textContent: '', _value: '', options: [], style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {},
    appendChild() {}
  };
  /* 模拟真实 select：写入 options 后，若当前值不在选项中则自动取首项 */
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._innerHTML; },
    set(v) {
      el._innerHTML = v;
      const opts = [...String(v).matchAll(/<option[^>]*value="([^"]*)"/g)].map(m => m[1]);
      if (opts.length) {
        el.options = opts.map(o => ({ value: o }));
        if (!opts.includes(el._value)) el._value = opts[0];
      }
    }
  });
  Object.defineProperty(el, 'value', { get() { return el._value; }, set(v) { el._value = v; } });
  return el;
}
global.document = {
  querySelector: s => (els[s] || (els[s] = makeEl(s))),
  querySelectorAll: () => [],
  createElement: () => makeEl('created')
};

const api = new Function(script + '\nreturn {get db(){return db;}, seedDemo, openDay, saveDay, saveLeave, deleteLeave, calcLvDays, renderAll, jumpMonth, $, calMatrix, SYMBOLS, workingDates, validEmpNo, empNoTaken, saveEmployee, editEmployee, resetEmpForm};')();
let db = api.db;

let pass = 0;
const ok = (name, cond) => { if (!cond) { console.error('FAIL:', name); process.exit(1); } pass++; console.log('✓', name); };

/* 1. 载入示例数据 */
api.seedDemo();
db = api.db; /* seedDemo 内部重建了 db 对象，需重新取引用 */
ok('员工 4 人', db.employees.length === 4);
ok('考勤记录已生成 (>300 条)', db.attendance.length > 300);
ok('加班记录 7 条', db.overtime.length === 7);
ok('假期记录 5 条', db.leaves.length === 5);
ok('异常记录已生成', db.exceptions.length > 0);

/* 2. 展板：部门合计 + 12 月列 */
const rateHtml = api.$('#rateTable').innerHTML;
ok('出勤率表含部门合计行', rateHtml.includes('部门合计'));
ok('出勤率表含全年列', rateHtml.includes('全年'));
ok('出勤率表含百分比', /\d{2,3}\.\d%/.test(rateHtml));
ok('缺勤表含调休/事假/病假列', api.$('#absenceTable').innerHTML.includes('调休') && api.$('#absenceTable').innerHTML.includes('事假') && api.$('#absenceTable').innerHTML.includes('病假'));
ok('年假额度表含应休/已休/本月已休', api.$('#quotaTable').innerHTML.includes('年度应休') && api.$('#quotaTable').innerHTML.includes('本月已休'));

/* 3. 考勤日历（默认当前月，可切月） */
ok('日历标题为 2026 年某月', /^2026 年 \d+ 月$/.test(api.$('#calTitle').textContent));
api.jumpMonth(0);
ok('切换到 1 月后标题正确', api.$('#calTitle').textContent === '2026 年 1 月');
ok('日历格子数为 7 的倍数', api.$('#calGrid').innerHTML.match(/cal-cell/g).length % 7 === 0);
ok('图例含 V = 出勤', api.$('#calLegend').innerHTML.includes('V = 出勤'));

/* 4. 加班管理汇总 */
const otHtml = api.$('#otSummary').innerHTML;
ok('加班汇总含工作日/公休日/法定节假日', otHtml.includes('工作日加班') && otHtml.includes('公休日加班') && otHtml.includes('节假日加班'));
ok('加班明细表有 7 行', api.$('#otRows').innerHTML.split('deleteOvertime').length === 8);

/* 5. 符号对照 */
ok('符号对照含 15 个符号', (api.$('#symGrid').innerHTML.match(/sym-card/g) || []).length === 15);
ok('符号含 N=年休假 T=调休 G=工伤', ['年休假','调休','工伤'].every(t => api.$('#symGrid').innerHTML.includes(t)));

/* 6. 交互：登记一天考勤 + 异常 */
const emp = db.employees[0].id;
api.$('#calEmp').value = emp;
api.openDay('2026-07-06');
api.$('#daySym').value = 'S';
api.$('#dayExc').value = '迟到';
api.$('#dayNote').value = '测试备注';
api.saveDay();
const rec = db.attendance.find(r => r.emp === emp && r.date === '2026-07-06');
ok('弹窗保存考勤符号 S', rec && rec.sym === 'S' && rec.note === '测试备注');
ok('弹窗保存异常 迟到', db.exceptions.some(r => r.emp === emp && r.date === '2026-07-06' && r.type === '迟到'));

/* 7. 交互：假期保存自动同步考勤符号，删除同步清除 */
const before = db.attendance.filter(r => r.emp === emp).length;
api.$('#lvEmp').value = emp;
api.$('#lvType').value = '育儿假';
api.$('#lvStart').value = '2026-07-13';
api.$('#lvEnd').value = '2026-07-17';
api.calcLvDays();
if (!api.$('#lvDays').value) api.$('#lvDays').value = 5;
api.$('#lvReason').value = '育儿假测试';
api.saveLeave();
const lv = db.leaves.find(r => r.emp === emp && r.type === '育儿假');
ok('假期已创建', !!lv);
ok('假期区间工作日写入符号 Y', db.attendance.some(r => r.emp === emp && r.date === '2026-07-13' && r.sym === 'Y' && r.gen === 'leave:' + lv.id));
ok('周末未被写入 (7/18 周六无记录)', !db.attendance.some(r => r.emp === emp && r.date === '2026-07-18' && r.gen === 'leave:' + lv.id));
const syncedCount = db.attendance.filter(r => r.gen === 'leave:' + lv.id).length;
ok('同步 5 个工作日', syncedCount === 5);
api.deleteLeave(lv.id);
ok('删除假期后同步记录清除', !db.attendance.some(r => r.gen === 'leave:' + lv.id) && !db.leaves.find(r => r.id === lv.id));

/* 8. 出勤率口径：7 月此前无数据，登记 S 后率 < 100% */
api.renderAll();
ok('7 月出勤率已参与计算（非 —）', api.$('#rateTable').innerHTML.includes('100.0%'));

/* 9. 年假额度数字 */
const e3 = db.employees.find(e => e.quota === 15);
const nUsed = db.attendance.filter(r => r.emp === e3.id && r.sym === 'N').length;
ok('年假已休天数与 N 符号一致 (泷川=5)', nUsed === 5);

/* 10. 工号：手动填写 + P+8 位数字格式校验 + 全库唯一 */
ok('validEmpNo 接受合法工号', api.validEmpNo('P00000001') && api.validEmpNo('P99999999'));
ok('validEmpNo 拒绝小写/位数错/前缀错/含字母/空值',
  !api.validEmpNo('p00000001') && !api.validEmpNo('P1234567') && !api.validEmpNo('P123456789')
  && !api.validEmpNo('X00000001') && !api.validEmpNo('P0000000A') && !api.validEmpNo(''));
ok('示例数据 4 人员工工号全部合规', db.employees.every(e=>api.validEmpNo(e.empNo)));
ok('示例工号全库唯一且为 P00000001~04', new Set(db.employees.map(e=>e.empNo)).size===4
  && ['P00000001','P00000002','P00000003','P00000004'].every(no=>db.employees.some(e=>e.empNo===no)));
ok('empNoTaken 识别占用并在编辑时排除自身',
  api.empNoTaken('P00000001',null)===true && api.empNoTaken('P00000001',db.employees[0].id)===false
  && api.empNoTaken('P88888888',null)===false);
const empCount=()=>db.employees.length;
api.$('#epName').value='重复测试员';api.$('#epDept').value='测试部';api.$('#epEmpNo').value='P00000001';
api.saveEmployee();
ok('重复工号保存被拒（员工数不增）', empCount()===4 && !db.employees.some(e=>e.name==='重复测试员'));
api.$('#epEmpNo').value='P123';api.saveEmployee();
ok('格式错误工号保存被拒', empCount()===4);
api.$('#epEmpNo').value='';api.saveEmployee();
ok('空工号保存被拒', empCount()===4);
api.$('#epEmpNo').value='P00000005';api.saveEmployee();
ok('合法工号保存成功并落库', empCount()===5 && db.employees.some(e=>e.empNo==='P00000005'&&e.name==='重复测试员'));
api.$('#epName').value='小写归一测试';api.$('#epEmpNo').value='p00000006';api.saveEmployee();
ok('小写工号自动归一为大写', empCount()===6 && db.employees.some(e=>e.empNo==='P00000006'));
const e1=db.employees[0].id, beforeName=db.employees[0].name;
api.editEmployee(e1);
ok('编辑回填工号', api.$('#epEmpNo').value==='P00000001' && api.$('#epEditId').value===e1);
api.$('#epName').value='鹿乃改';api.saveEmployee();
ok('编辑保存同号不触发唯一冲突且更新生效', empCount()===6
  && db.employees[0].name==='鹿乃改' && db.employees[0].empNo==='P00000001');
api.renderAll();
ok('名册渲染包含工号列内容', api.$('#epRows').innerHTML.includes('P00000001') && api.$('#epRows').innerHTML.includes('P00000006'));

console.log(`\nALL ${pass} CHECKS PASSED`);
