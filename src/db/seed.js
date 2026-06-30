require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('./database');
const { createSchema } = require('./schema');

createSchema();

const run = db.transaction(() => {
  // Clear in dependency order
  db.exec(`
    DELETE FROM forum_messages; DELETE FROM forum_threads;
    DELETE FROM email_alerts; DELETE FROM announcements;
    DELETE FROM teacher_payroll;
    DELETE FROM payments; DELETE FROM fee_records;
    DELETE FROM report_card_entries; DELETE FROM report_cards;
    DELETE FROM marks;
    DELETE FROM teacher_schedule; DELETE FROM teacher_attendance;
    DELETE FROM attendance_records;
    DELETE FROM parent_students; DELETE FROM parents;
    DELETE FROM students;
    DELETE FROM classes;
    DELETE FROM teachers;
    DELETE FROM grade_levels; DELETE FROM subjects;
    DELETE FROM terms; DELETE FROM academic_years;
    DELETE FROM school;
    DELETE FROM users;
  `);

  // ── School ─────────────────────────────────────────────────────
  db.prepare(`INSERT INTO school VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
    's1','Bright Stars Primary School','BSPS-001',
    '12 Academic Avenue, Harare','+263 242 123 456','info@brightstars.edu',
    'Mrs. Grace Moyo','Excellence Through Knowledge',null
  );

  // ── Academic Years ──────────────────────────────────────────────
  const insAY = db.prepare(`INSERT INTO academic_years VALUES (?,?,?,?,?)`);
  insAY.run('ay1','2025/2026','2025-01-15','2025-11-28',1);
  insAY.run('ay2','2024/2025','2024-01-17','2024-11-29',0);

  // ── Terms ───────────────────────────────────────────────────────
  const insTerm = db.prepare(`INSERT INTO terms VALUES (?,?,?,?,?,?)`);
  insTerm.run('t1','ay1','first', '2025-01-15','2025-04-11',0);
  insTerm.run('t2','ay1','second','2025-05-06','2025-08-08',1);
  insTerm.run('t3','ay1','third', '2025-09-09','2025-11-28',0);

  // ── Grade Levels ────────────────────────────────────────────────
  const insGL = db.prepare(`INSERT INTO grade_levels VALUES (?,?,?)`);
  [['gl0','ECD A',0],['gl1','ECD B',1],['gl2','Grade 1',2],['gl3','Grade 2',3],
   ['gl4','Grade 3',4],['gl5','Grade 4',5],['gl6','Grade 5',6],['gl7','Grade 6',7],['gl8','Grade 7',8]]
    .forEach(r => insGL.run(...r));

  // ── Subjects ────────────────────────────────────────────────────
  const insSub = db.prepare(`INSERT INTO subjects VALUES (?,?,?)`);
  [['sub1','English Language','ENG'],['sub2','Mathematics','MTH'],['sub3','General Science','SCI'],
   ['sub4','Social Studies','SST'],['sub5','Shona','SHO'],['sub6','Religious & Moral','RME'],
   ['sub7','Art & Craft','ART'],['sub8','Physical Education','PE']]
    .forEach(r => insSub.run(...r));

  // ── Teachers ────────────────────────────────────────────────────
  const insTc = db.prepare(`INSERT INTO teachers (id,first_name,last_name,email,phone,gender,subjects,class_assigned,qualification,join_date,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`);
  const teachers = [
    ['tc1','Rutendo','Zulu','r.zulu@bsps.edu','+263 77 111 2201','female','["English Language","Social Studies"]','Grade 2A','B.Ed Primary','2018-01-10',1],
    ['tc2','Farai','Ncube','f.ncube@bsps.edu','+263 77 111 2202','male','["Mathematics","General Science"]','Grade 3A','B.Ed Mathematics','2019-02-01',1],
    ['tc3','Chipo','Ndlovu','c.ndlovu@bsps.edu','+263 77 111 2203','female','["English Language","Shona"]','Grade 1A','Diploma in Education','2020-01-15',1],
    ['tc4','Tinashe','Moyo','t.moyo@bsps.edu','+263 77 111 2204','male','["Mathematics","Art & Craft"]','Grade 1B','B.Ed Primary','2021-01-10',1],
    ['tc5','Tapiwa','Dube','t.dube@bsps.edu','+263 77 111 2205','female','["General Science","Social Studies"]','Grade 4A','B.Sc Education','2017-01-08',1],
    ['tc6','Blessing','Sibanda','b.sibanda@bsps.edu','+263 77 111 2206','male','["Physical Education","Art & Craft"]','Grade 5A','B.Ed Physical Education','2016-02-14',1],
  ];
  teachers.forEach(r => insTc.run(...r));

  // ── Classes ─────────────────────────────────────────────────────
  const insCls = db.prepare(`INSERT INTO classes VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`);
  [['c1','gl2','Grade 1','Grade 1A',35,'Room 1','tc3','Mrs. Chipo Ndlovu',32],
   ['c2','gl2','Grade 1','Grade 1B',35,'Room 2','tc4','Mr. Tinashe Moyo',30],
   ['c3','gl3','Grade 2','Grade 2A',38,'Room 3','tc1','Mrs. Rutendo Zulu',36],
   ['c4','gl4','Grade 3','Grade 3A',40,'Room 4','tc2','Mr. Farai Ncube',38],
   ['c5','gl5','Grade 4','Grade 4A',40,'Room 5','tc5','Mrs. Tapiwa Dube',37],
   ['c6','gl6','Grade 5','Grade 5A',40,'Room 6','tc6','Mr. Blessing Sibanda',35],
   ['c7','gl7','Grade 6','Grade 6A',40,'Room 7','tc6','Mr. Blessing Sibanda',33],
   ['c8','gl8','Grade 7','Grade 7A',40,'Room 8','tc1','Mrs. Rutendo Zulu',34]]
    .forEach(r => insCls.run(...r));

  // ── Students ─────────────────────────────────────────────────────
  const insSt = db.prepare(`INSERT INTO students (id,student_number,first_name,last_name,date_of_birth,gender,class_id,class_name,grade_level_name,photo_url,guardian_name,guardian_phone,guardian_relationship,admission_date,is_active,address,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`);
  [
    ['st1','BSPS-2025-001','Amara','Chidziva','2017-03-14','female','c1','Grade 1A','Grade 1',null,'Mr. John Chidziva','+263 77 200 0001','father','2025-01-15',1,'14 Mbare St'],
    ['st2','BSPS-2025-002','Tafadzwa','Moyo','2017-06-22','male','c1','Grade 1A','Grade 1',null,'Mrs. Alice Moyo','+263 77 200 0002','mother','2025-01-15',1,'5 Avondale Rd'],
    ['st3','BSPS-2025-003','Nyasha','Banda','2017-11-08','female','c1','Grade 1A','Grade 1',null,'Mr. Peter Banda','+263 77 200 0003','father','2025-01-15',1,'22 Glen View'],
    ['st4','BSPS-2025-004','Tatenda','Nhamo','2016-04-17','male','c3','Grade 2A','Grade 2',null,'Mrs. Sisi Nhamo','+263 77 200 0004','mother','2024-01-17',1,'8 Budiriro'],
    ['st5','BSPS-2025-005','Ruvimbo','Sithole','2016-08-30','female','c3','Grade 2A','Grade 2',null,'Mr. Dan Sithole','+263 77 200 0005','father','2024-01-17',1,'3 Waterfalls'],
    ['st6','BSPS-2025-006','Panashe','Chirwa','2015-01-05','male','c4','Grade 3A','Grade 3',null,'Mrs. Ruth Chirwa','+263 77 200 0006','mother','2023-01-18',1,'19 Borrowdale'],
    ['st7','BSPS-2025-007','Tariro','Mwangi','2015-05-19','female','c4','Grade 3A','Grade 3',null,'Mr. Samuel Mwangi','+263 77 200 0007','father','2023-01-18',1,'7 Highlands'],
    ['st8','BSPS-2025-008','Simba','Dlamini','2014-09-12','male','c5','Grade 4A','Grade 4',null,'Mrs. Lindiwe Dlamini','+263 77 200 0008','mother','2022-01-19',1,'11 Greendale'],
    ['st9','BSPS-2025-009','Chenai','Mutasa','2014-12-25','female','c5','Grade 4A','Grade 4',null,'Mr. Tongesai Mutasa','+263 77 200 0009','father','2022-01-19',1,'30 Msasa'],
    ['st10','BSPS-2025-010','Takunda','Gumbo','2013-02-14','male','c6','Grade 5A','Grade 5',null,'Mrs. Flora Gumbo','+263 77 200 0010','mother','2021-01-20',1,'2 Eastlea'],
    ['st11','BSPS-2025-011','Rutendo','Chikwanda','2013-07-09','female','c6','Grade 5A','Grade 5',null,'Mr. Isaac Chikwanda','+263 77 200 0011','father','2021-01-20',1,'6 Hatfield'],
    ['st12','BSPS-2025-012','Munyaradzi','Hove','2012-10-01','male','c7','Grade 6A','Grade 6',null,'Mrs. Clara Hove','+263 77 200 0012','mother','2020-01-15',1,'14 Marlborough'],
    ['st13','BSPS-2025-013','Tsitsi','Mapfumo','2012-04-18','female','c7','Grade 6A','Grade 6',null,'Mr. Tafara Mapfumo','+263 77 200 0013','father','2020-01-15',1,'9 Belvedere'],
    ['st14','BSPS-2025-014','Farai','Zimba','2011-08-23','male','c8','Grade 7A','Grade 7',null,'Mrs. Rejoice Zimba','+263 77 200 0014','mother','2019-01-16',1,'18 Dzivaresekwa'],
    ['st15','BSPS-2025-015','Vimbai','Ncube','2011-11-30','female','c8','Grade 7A','Grade 7',null,'Mr. Godfrey Ncube','+263 77 200 0015','father','2019-01-16',1,'25 Kuwadzana'],
  ].forEach(r => insSt.run(...r));

  // ── Attendance Records ───────────────────────────────────────────
  const insAtt = db.prepare(`INSERT INTO attendance_records VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`);
  [
    ['at1','st1','Amara Chidziva','BSPS-2025-001','c1','Grade 1A','2025-06-04','present',null],
    ['at2','st2','Tafadzwa Moyo','BSPS-2025-002','c1','Grade 1A','2025-06-04','present',null],
    ['at3','st3','Nyasha Banda','BSPS-2025-003','c1','Grade 1A','2025-06-04','absent',null],
    ['at4','st4','Tatenda Nhamo','BSPS-2025-004','c3','Grade 2A','2025-06-04','present',null],
    ['at5','st5','Ruvimbo Sithole','BSPS-2025-005','c3','Grade 2A','2025-06-04','late',null],
    ['at6','st6','Panashe Chirwa','BSPS-2025-006','c4','Grade 3A','2025-06-04','present',null],
    ['at7','st7','Tariro Mwangi','BSPS-2025-007','c4','Grade 3A','2025-06-04','present',null],
    ['at8','st8','Simba Dlamini','BSPS-2025-008','c5','Grade 4A','2025-06-04','absent',null],
    ['at9','st9','Chenai Mutasa','BSPS-2025-009','c5','Grade 4A','2025-06-04','present',null],
    ['at10','st10','Takunda Gumbo','BSPS-2025-010','c6','Grade 5A','2025-06-04','present',null],
    ['at11','st11','Rutendo Chikwanda','BSPS-2025-011','c6','Grade 5A','2025-06-04','excused',null],
    ['at12','st12','Munyaradzi Hove','BSPS-2025-012','c7','Grade 6A','2025-06-04','present',null],
    ['at13','st13','Tsitsi Mapfumo','BSPS-2025-013','c7','Grade 6A','2025-06-04','present',null],
    ['at14','st14','Farai Zimba','BSPS-2025-014','c8','Grade 7A','2025-06-04','present',null],
    ['at15','st15','Vimbai Ncube','BSPS-2025-015','c8','Grade 7A','2025-06-04','present',null],
  ].forEach(r => insAtt.run(...r));

  // ── Teacher Attendance ──────────────────────────────────────────
  const insTa = db.prepare(`INSERT INTO teacher_attendance VALUES (?,?,?,?,?)`);
  const juneDays = ['2025-06-02','2025-06-03','2025-06-04','2025-06-05','2025-06-06',
                    '2025-06-09','2025-06-10','2025-06-11','2025-06-12','2025-06-13',
                    '2025-06-16','2025-06-17','2025-06-18','2025-06-19','2025-06-20',
                    '2025-06-23','2025-06-24','2025-06-25','2025-06-26','2025-06-27'];
  const tcAbsences = { tc1:['2025-06-10','2025-06-18'], tc2:['2025-06-05'], tc3:['2025-06-12','2025-06-13'], tc4:[], tc5:['2025-06-20'], tc6:['2025-06-03','2025-06-25'] };
  const tcLate     = { tc1:['2025-06-16'], tc2:['2025-06-23'], tc3:['2025-06-09'], tc4:['2025-06-17'], tc5:['2025-06-11'], tc6:['2025-06-19'] };
  Object.keys(tcAbsences).forEach(tid => {
    juneDays.forEach((date, i) => {
      const status = tcAbsences[tid].includes(date) ? 'absent' : tcLate[tid]?.includes(date) ? 'late' : 'present';
      insTa.run(`ta-${tid}-${i}`, tid, date, status, null);
    });
  });

  // ── Timetable ───────────────────────────────────────────────────
  const insSch = db.prepare(`INSERT INTO teacher_schedule VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const scheduleData = [
    // tc1 — Rutendo Zulu
    ['tc1','monday','p1','Period 1','07:30–08:10','c3','Grade 2A','English Language','Room 3'],
    ['tc1','monday','p2','Period 2','08:10–08:50','c3','Grade 2A','Social Studies','Room 3'],
    ['tc1','monday','p4','Period 4','09:50–10:30','c8','Grade 7A','English Language','Room 8'],
    ['tc1','monday','p6','Period 6','11:50–12:30','c8','Grade 7A','Social Studies','Room 8'],
    ['tc1','tuesday','p1','Period 1','07:30–08:10','c3','Grade 2A','English Language','Room 3'],
    ['tc1','tuesday','p3','Period 3','09:10–09:50','c3','Grade 2A','Social Studies','Room 3'],
    ['tc1','tuesday','p5','Period 5','10:30–11:10','c8','Grade 7A','English Language','Room 8'],
    ['tc1','wednesday','p2','Period 2','08:10–08:50','c3','Grade 2A','English Language','Room 3'],
    ['tc1','wednesday','p4','Period 4','09:50–10:30','c8','Grade 7A','Social Studies','Room 8'],
    ['tc1','wednesday','p6','Period 6','11:50–12:30','c3','Grade 2A','Social Studies','Room 3'],
    ['tc1','thursday','p1','Period 1','07:30–08:10','c8','Grade 7A','English Language','Room 8'],
    ['tc1','thursday','p3','Period 3','09:10–09:50','c3','Grade 2A','English Language','Room 3'],
    ['tc1','thursday','p7','Period 7','12:30–13:10','c8','Grade 7A','Social Studies','Room 8'],
    ['tc1','friday','p2','Period 2','08:10–08:50','c3','Grade 2A','Social Studies','Room 3'],
    ['tc1','friday','p4','Period 4','09:50–10:30','c8','Grade 7A','English Language','Room 8'],
    ['tc1','friday','p6','Period 6','11:50–12:30','c3','Grade 2A','English Language','Room 3'],
    // tc2 — Farai Ncube
    ['tc2','monday','p1','Period 1','07:30–08:10','c4','Grade 3A','Mathematics','Room 4'],
    ['tc2','monday','p3','Period 3','09:10–09:50','c4','Grade 3A','General Science','Room 4'],
    ['tc2','monday','p6','Period 6','11:50–12:30','c5','Grade 4A','Mathematics','Room 5'],
    ['tc2','tuesday','p2','Period 2','08:10–08:50','c4','Grade 3A','Mathematics','Room 4'],
    ['tc2','tuesday','p4','Period 4','09:50–10:30','c4','Grade 3A','General Science','Room 4'],
    ['tc2','tuesday','p7','Period 7','12:30–13:10','c5','Grade 4A','General Science','Room 5'],
    ['tc2','wednesday','p1','Period 1','07:30–08:10','c4','Grade 3A','General Science','Room 4'],
    ['tc2','wednesday','p3','Period 3','09:10–09:50','c4','Grade 3A','Mathematics','Room 4'],
    ['tc2','wednesday','p5','Period 5','10:30–11:10','c5','Grade 4A','Mathematics','Room 5'],
    ['tc2','thursday','p2','Period 2','08:10–08:50','c4','Grade 3A','Mathematics','Room 4'],
    ['tc2','thursday','p4','Period 4','09:50–10:30','c4','Grade 3A','General Science','Room 4'],
    ['tc2','thursday','p6','Period 6','11:50–12:30','c5','Grade 4A','General Science','Room 5'],
    ['tc2','friday','p1','Period 1','07:30–08:10','c4','Grade 3A','Mathematics','Room 4'],
    ['tc2','friday','p5','Period 5','10:30–11:10','c4','Grade 3A','General Science','Room 4'],
    ['tc2','friday','p7','Period 7','12:30–13:10','c5','Grade 4A','Mathematics','Room 5'],
    // tc3 — Chipo Ndlovu
    ['tc3','monday','p1','Period 1','07:30–08:10','c1','Grade 1A','English Language','Room 1'],
    ['tc3','monday','p2','Period 2','08:10–08:50','c1','Grade 1A','Shona','Room 1'],
    ['tc3','monday','p5','Period 5','10:30–11:10','c1','Grade 1A','English Language','Room 1'],
    ['tc3','tuesday','p1','Period 1','07:30–08:10','c1','Grade 1A','Shona','Room 1'],
    ['tc3','tuesday','p3','Period 3','09:10–09:50','c1','Grade 1A','English Language','Room 1'],
    ['tc3','tuesday','p6','Period 6','11:50–12:30','c1','Grade 1A','Shona','Room 1'],
    ['tc3','wednesday','p2','Period 2','08:10–08:50','c1','Grade 1A','English Language','Room 1'],
    ['tc3','wednesday','p4','Period 4','09:50–10:30','c1','Grade 1A','Shona','Room 1'],
    ['tc3','wednesday','p7','Period 7','12:30–13:10','c1','Grade 1A','English Language','Room 1'],
    ['tc3','thursday','p1','Period 1','07:30–08:10','c1','Grade 1A','English Language','Room 1'],
    ['tc3','thursday','p3','Period 3','09:10–09:50','c1','Grade 1A','Shona','Room 1'],
    ['tc3','friday','p2','Period 2','08:10–08:50','c1','Grade 1A','English Language','Room 1'],
    ['tc3','friday','p4','Period 4','09:50–10:30','c1','Grade 1A','Shona','Room 1'],
    ['tc3','friday','p6','Period 6','11:50–12:30','c1','Grade 1A','English Language','Room 1'],
    // tc4 — Tinashe Moyo
    ['tc4','monday','p1','Period 1','07:30–08:10','c2','Grade 1B','Mathematics','Room 2'],
    ['tc4','monday','p3','Period 3','09:10–09:50','c2','Grade 1B','Art & Craft','Room 2'],
    ['tc4','monday','p6','Period 6','11:50–12:30','c2','Grade 1B','Mathematics','Room 2'],
    ['tc4','tuesday','p2','Period 2','08:10–08:50','c2','Grade 1B','Mathematics','Room 2'],
    ['tc4','tuesday','p5','Period 5','10:30–11:10','c2','Grade 1B','Art & Craft','Room 2'],
    ['tc4','wednesday','p1','Period 1','07:30–08:10','c2','Grade 1B','Art & Craft','Room 2'],
    ['tc4','wednesday','p3','Period 3','09:10–09:50','c2','Grade 1B','Mathematics','Room 2'],
    ['tc4','wednesday','p6','Period 6','11:50–12:30','c2','Grade 1B','Art & Craft','Room 2'],
    ['tc4','thursday','p2','Period 2','08:10–08:50','c2','Grade 1B','Mathematics','Room 2'],
    ['tc4','thursday','p4','Period 4','09:50–10:30','c2','Grade 1B','Art & Craft','Room 2'],
    ['tc4','friday','p1','Period 1','07:30–08:10','c2','Grade 1B','Mathematics','Room 2'],
    ['tc4','friday','p3','Period 3','09:10–09:50','c2','Grade 1B','Art & Craft','Room 2'],
    ['tc4','friday','p5','Period 5','10:30–11:10','c2','Grade 1B','Mathematics','Room 2'],
    // tc5 — Tapiwa Dube
    ['tc5','monday','p2','Period 2','08:10–08:50','c5','Grade 4A','General Science','Room 5'],
    ['tc5','monday','p4','Period 4','09:50–10:30','c5','Grade 4A','Social Studies','Room 5'],
    ['tc5','monday','p7','Period 7','12:30–13:10','c5','Grade 4A','General Science','Room 5'],
    ['tc5','tuesday','p1','Period 1','07:30–08:10','c5','Grade 4A','Social Studies','Room 5'],
    ['tc5','tuesday','p3','Period 3','09:10–09:50','c5','Grade 4A','General Science','Room 5'],
    ['tc5','wednesday','p2','Period 2','08:10–08:50','c5','Grade 4A','General Science','Room 5'],
    ['tc5','wednesday','p6','Period 6','11:50–12:30','c5','Grade 4A','Social Studies','Room 5'],
    ['tc5','thursday','p1','Period 1','07:30–08:10','c5','Grade 4A','General Science','Room 5'],
    ['tc5','thursday','p5','Period 5','10:30–11:10','c5','Grade 4A','Social Studies','Room 5'],
    ['tc5','friday','p2','Period 2','08:10–08:50','c5','Grade 4A','General Science','Room 5'],
    ['tc5','friday','p4','Period 4','09:50–10:30','c5','Grade 4A','Social Studies','Room 5'],
    ['tc5','friday','p7','Period 7','12:30–13:10','c5','Grade 4A','General Science','Room 5'],
    // tc6 — Blessing Sibanda
    ['tc6','monday','p2','Period 2','08:10–08:50','c6','Grade 5A','Physical Education','Room 6'],
    ['tc6','monday','p4','Period 4','09:50–10:30','c7','Grade 6A','Art & Craft','Room 7'],
    ['tc6','monday','p7','Period 7','12:30–13:10','c6','Grade 5A','Art & Craft','Room 6'],
    ['tc6','tuesday','p1','Period 1','07:30–08:10','c7','Grade 6A','Physical Education','Room 7'],
    ['tc6','tuesday','p3','Period 3','09:10–09:50','c6','Grade 5A','Physical Education','Room 6'],
    ['tc6','tuesday','p6','Period 6','11:50–12:30','c7','Grade 6A','Art & Craft','Room 7'],
    ['tc6','wednesday','p2','Period 2','08:10–08:50','c6','Grade 5A','Art & Craft','Room 6'],
    ['tc6','wednesday','p4','Period 4','09:50–10:30','c7','Grade 6A','Physical Education','Room 7'],
    ['tc6','thursday','p1','Period 1','07:30–08:10','c6','Grade 5A','Physical Education','Room 6'],
    ['tc6','thursday','p3','Period 3','09:10–09:50','c7','Grade 6A','Art & Craft','Room 7'],
    ['tc6','thursday','p6','Period 6','11:50–12:30','c6','Grade 5A','Art & Craft','Room 6'],
    ['tc6','friday','p2','Period 2','08:10–08:50','c7','Grade 6A','Physical Education','Room 7'],
    ['tc6','friday','p4','Period 4','09:50–10:30','c6','Grade 5A','Art & Craft','Room 6'],
    ['tc6','friday','p6','Period 6','11:50–12:30','c7','Grade 6A','Physical Education','Room 7'],
  ];
  scheduleData.forEach(([tid, day, pk, pl, time, cid, cname, sub, room], i) => {
    insSch.run(`ts-${tid}-${i}`, tid, day, pk, pl, time, cid, cname, sub, room);
  });

  // ── Marks ──────────────────────────────────────────────────────
  const insMk = db.prepare(`INSERT INTO marks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`);
  [
    ['mk1','st6','Panashe Chirwa','BSPS-2025-006','sub1','English Language','t1','c4',35,52,87,'A','Excellent'],
    ['mk2','st6','Panashe Chirwa','BSPS-2025-006','sub2','Mathematics','t1','c4',38,55,93,'A+','Excellent'],
    ['mk3','st6','Panashe Chirwa','BSPS-2025-006','sub3','General Science','t1','c4',30,48,78,'B','Good'],
    ['mk4','st6','Panashe Chirwa','BSPS-2025-006','sub4','Social Studies','t1','c4',32,50,82,'A','Very Good'],
    ['mk5','st6','Panashe Chirwa','BSPS-2025-006','sub5','Shona','t1','c4',36,51,87,'A','Excellent'],
    ['mk6','st7','Tariro Mwangi','BSPS-2025-007','sub1','English Language','t1','c4',28,43,71,'B','Good'],
    ['mk7','st7','Tariro Mwangi','BSPS-2025-007','sub2','Mathematics','t1','c4',25,38,63,'C','Average'],
    ['mk8','st7','Tariro Mwangi','BSPS-2025-007','sub3','General Science','t1','c4',33,49,82,'A','Very Good'],
    ['mk9','st7','Tariro Mwangi','BSPS-2025-007','sub4','Social Studies','t1','c4',29,44,73,'B','Good'],
    ['mk10','st7','Tariro Mwangi','BSPS-2025-007','sub5','Shona','t1','c4',31,46,77,'B','Good'],
  ].forEach(r => insMk.run(...r));

  // ── Report Cards ────────────────────────────────────────────────
  const insRC = db.prepare(`INSERT INTO report_cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`);
  const insRCE = db.prepare(`INSERT INTO report_card_entries VALUES (?,?,?,?,?,?,?,?,?,?,?)`);

  const rcData = [
    { id:'rc1', sid:'st1', sname:'Panashe Chirwa', snum:'BSPS-2025-006', cls:'Grade 3A', gl:'Grade 3',
      tid:'t1', tn:'first', ay:'2025/2026', mo:427, mp:500, pct:85.4, pos:2, oof:38, dp:56, da:2, tsd:58,
      cond:'Excellent', ctc:'Panashe is a dedicated and enthusiastic learner.',
      htc:'A commendable performance. Continue to strive for excellence.', st:'published',
      entries:[
        ['rce1','rc1','sub1','English Language',35,52,87,'A','Excellent',3,'Excellent reading and comprehension skills.'],
        ['rce2','rc1','sub2','Mathematics',38,55,93,'A+','Excellent',1,'Outstanding mathematical ability.'],
        ['rce3','rc1','sub3','General Science',30,48,78,'B','Good',8,'Good understanding of concepts.'],
        ['rce4','rc1','sub4','Social Studies',32,50,82,'A','Very Good',5,'Shows great interest in social topics.'],
        ['rce5','rc1','sub5','Shona',36,51,87,'A','Excellent',2,'Excellent spoken and written Shona.'],
      ]
    },
    { id:'rc2', sid:'st2', sname:'Tariro Mwangi', snum:'BSPS-2025-007', cls:'Grade 3A', gl:'Grade 3',
      tid:'t1', tn:'first', ay:'2025/2026', mo:366, mp:500, pct:73.2, pos:9, oof:38, dp:54, da:4, tsd:58,
      cond:'Good', ctc:'Tariro works hard and shows improvement each week.',
      htc:'A solid effort this term.', st:'published',
      entries:[
        ['rce6','rc2','sub1','English Language',28,43,71,'B','Good',12,'Adequate comprehension and expression.'],
        ['rce7','rc2','sub2','Mathematics',25,38,63,'C','Average',20,'Needs additional practice with problem-solving.'],
        ['rce8','rc2','sub3','General Science',33,49,82,'A','Very Good',4,'Very good performance in science experiments.'],
        ['rce9','rc2','sub4','Social Studies',29,44,73,'B','Good',11,'Good effort in social studies discussions.'],
        ['rce10','rc2','sub5','Shona',31,46,77,'B','Good',9,'Good command of Shona language.'],
      ]
    },
  ];
  rcData.forEach(rc => {
    insRC.run(rc.id, rc.sid, rc.sname, rc.snum, rc.cls, rc.gl, rc.tid, rc.tn, rc.ay,
              rc.mo, rc.mp, rc.pct, rc.pos, rc.oof, rc.dp, rc.da, rc.tsd,
              rc.cond, rc.ctc, rc.htc, rc.st);
    rc.entries.forEach(e => insRCE.run(...e));
  });

  // ── Fee Records ──────────────────────────────────────────────────
  const insFR = db.prepare(`INSERT INTO fee_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`);
  const insPay = db.prepare(`INSERT INTO payments VALUES (?,?,?,?,?,?,?,datetime('now'))`);
  [
    { id:'fr1', sid:'st1', sn:'Amara Chidziva', num:'BSPS-2025-001', cid:'c1', cn:'Grade 1A', fn:'Term 1 School Fees 2025', ay:'2025/2026', due:100000, paid:100000, bal:0, st:'paid', dd:'2025-01-31',
      pays:[['p1','fr1',100000,'Bank Transfer','TXN-2025-001','2025-01-20','RCP-001']] },
    { id:'fr2', sid:'st2', sn:'Tafadzwa Moyo', num:'BSPS-2025-002', cid:'c1', cn:'Grade 1A', fn:'Term 1 School Fees 2025', ay:'2025/2026', due:100000, paid:60000, bal:40000, st:'partial', dd:'2025-01-31',
      pays:[['p2','fr2',60000,'Cash','','2025-01-25','RCP-002']] },
    { id:'fr3', sid:'st4', sn:'Tatenda Nhamo', num:'BSPS-2025-004', cid:'c3', cn:'Grade 2A', fn:'Term 1 School Fees 2025', ay:'2025/2026', due:100000, paid:0, bal:100000, st:'overdue', dd:'2025-01-31', pays:[] },
    { id:'fr4', sid:'st6', sn:'Panashe Chirwa', num:'BSPS-2025-006', cid:'c4', cn:'Grade 3A', fn:'Term 1 School Fees 2025', ay:'2025/2026', due:100000, paid:100000, bal:0, st:'paid', dd:'2025-01-31',
      pays:[['p4','fr4',100000,'Mobile Money','MM-2025-101','2025-01-18','RCP-004']] },
    { id:'fr5', sid:'st8', sn:'Simba Dlamini', num:'BSPS-2025-008', cid:'c5', cn:'Grade 4A', fn:'Term 1 School Fees 2025', ay:'2025/2026', due:100000, paid:100000, bal:0, st:'paid', dd:'2025-01-31',
      pays:[['p5','fr5',100000,'Bank Transfer','TXN-2025-005','2025-01-15','RCP-005']] },
    { id:'fr6', sid:'st10', sn:'Takunda Gumbo', num:'BSPS-2025-010', cid:'c6', cn:'Grade 5A', fn:'Term 1 School Fees 2025', ay:'2025/2026', due:100000, paid:75000, bal:25000, st:'partial', dd:'2025-01-31',
      pays:[['p6','fr6',75000,'Cash','','2025-02-01','RCP-006']] },
    { id:'fr7', sid:'st12', sn:'Munyaradzi Hove', num:'BSPS-2025-012', cid:'c7', cn:'Grade 6A', fn:'Term 1 School Fees 2025', ay:'2025/2026', due:100000, paid:0, bal:100000, st:'pending', dd:'2025-05-31', pays:[] },
    { id:'fr8', sid:'st14', sn:'Farai Zimba', num:'BSPS-2025-014', cid:'c8', cn:'Grade 7A', fn:'Term 1 School Fees 2025', ay:'2025/2026', due:100000, paid:100000, bal:0, st:'paid', dd:'2025-01-31',
      pays:[['p8','fr8',100000,'Bank Transfer','TXN-2025-008','2025-01-14','RCP-008']] },
  ].forEach(fr => {
    insFR.run(fr.id, fr.sid, fr.sn, fr.num, fr.cid, fr.cn, fr.fn, fr.ay, fr.due, fr.paid, fr.bal, fr.st, fr.dd);
    fr.pays.forEach(p => insPay.run(...p));
  });

  // ── Teacher Payroll ──────────────────────────────────────────────
  const insPR = db.prepare(`INSERT INTO teacher_payroll VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`);
  const seed = { tc1:[78,1,0], tc2:[82,0,2], tc3:[75,2,1], tc4:[80,0,0], tc5:[76,1,3], tc6:[70,3,2] };
  Object.entries(seed).forEach(([tid, [hrs,abs,late]], i) => {
    insPR.run(`pr-${tid}-2026-06`, tid, '2026-06', 3500, 80, 50000, 12000, 2500, hrs, abs, late, 0, '', 'draft');
  });

  // ── Announcements ────────────────────────────────────────────────
  const insAnn = db.prepare(`INSERT INTO announcements (id,title,body,author,author_id,audience,is_pinned) VALUES (?,?,?,?,?,?,?)`);
  insAnn.run('ann1','End of Term Exams Schedule','End of Term 2 examinations will begin on 28 July 2025. All students must report by 7:00 AM.','Mrs. Grace Moyo',null,'all',1);
  insAnn.run('ann2','Parent-Teacher Meeting','The school will host a Parent-Teacher meeting on Friday 13 June 2025 from 2 PM.','Mrs. Grace Moyo',null,'parents',0);
  insAnn.run('ann3','Sports Day','Annual Sports Day is scheduled for 20 June 2025. Students should bring PE attire.','Mr. Blessing Sibanda',null,'all',0);

  // ── Forum Threads ────────────────────────────────────────────────
  const insFT = db.prepare(`INSERT INTO forum_threads VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))`);
  const insFM = db.prepare(`INSERT INTO forum_messages VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`);
  [
    ['ft1','General Discussion','general','Admin',null,1,2],
    ['ft2','Academic Support','academic','Mrs. Rutendo Zulu',null,0,1],
    ['ft3','Upcoming Events','events','Mr. Blessing Sibanda',null,0,1],
    ['ft4','Staff Notices','admin','Mrs. Grace Moyo',null,0,1],
  ].forEach(r => insFT.run(...r));
  [
    ['fm1','ft1','Admin',null,'text','Welcome to the school discussion forum!',null,null,null],
    ['fm2','ft1','Mrs. Grace Moyo',null,'text','Please review the exam timetable.',null,null,null],
    ['fm3','ft2','Mrs. Rutendo Zulu',null,'text','Extra English lessons will be held every Wednesday.',null,null,null],
    ['fm4','ft3','Mr. Blessing Sibanda',null,'text','Sports Day preparations are underway. Teams are confirmed.',null,null,null],
    ['fm5','ft4','Mrs. Grace Moyo',null,'text','All staff meeting on Thursday at 14:00 in the staffroom.',null,null,null],
  ].forEach(r => insFM.run(...r));

  // ── Parents ──────────────────────────────────────────────────────
  const insP = db.prepare(`INSERT INTO parents (id,name,email,phone,relationship,address,occupation,created_at,updated_at) VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))`);
  const insPSt = db.prepare(`INSERT INTO parent_students VALUES (?,?)`);
  [
    ['par1','Mr. John Chidziva',null,'+263 77 200 0001','father','14 Mbare St','Business Owner'],
    ['par2','Mrs. Alice Moyo',null,'+263 77 200 0002','mother','5 Avondale Rd','Teacher'],
    ['par3','Mr. Peter Banda',null,'+263 77 200 0003','father','22 Glen View','Engineer'],
    ['par4','Mrs. Sisi Nhamo',null,'+263 77 200 0004','mother','8 Budiriro','Nurse'],
    ['par5','Mrs. Ruth Chirwa',null,'+263 77 200 0006','mother','19 Borrowdale','Accountant'],
  ].forEach(r => insP.run(...r));
  [['par1','st1'],['par2','st2'],['par3','st3'],['par4','st4'],['par5','st6']].forEach(r => insPSt.run(...r));

  // ── Users (auth) ─────────────────────────────────────────────────
  const hash = (pw) => bcrypt.hashSync(pw, 10);
  // 11 columns: id, name, email, password_hash, role, initials, teacher_id, student_id, parent_id, created_at, updated_at
  const insUser = db.prepare(`INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`);
  insUser.run(uuidv4(),'Administrator','admin@school.com',hash('Admin@2025'),'super_admin','AD',null,null,null);
});

run();
console.log('✓ Database seeded successfully.');
