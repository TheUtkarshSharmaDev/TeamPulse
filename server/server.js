const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();

const PORT = Number(process.env.PORT) || 5000;

const JWT_SECRET =
  process.env.JWT_SECRET || "local-teampulse-secret-change-this";

const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:5173";

/* =========================
   CORS
========================= */

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log("Blocked CORS origin:", origin);

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "10kb" }));

/* =========================
   DATABASE
========================= */

const db = new Database("teampulse.db");

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    initials TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    priority TEXT NOT NULL DEFAULT 'Medium',
    assignee_id INTEGER,
    created_by INTEGER,
    points INTEGER NOT NULL DEFAULT 0,
    points_awarded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    FOREIGN KEY (assignee_id) REFERENCES members(id),
    FOREIGN KEY (created_by) REFERENCES members(id)
  );

  CREATE TABLE IF NOT EXISTS weekly_admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    week_start TEXT NOT NULL,
    week_end TEXT NOT NULL,
    FOREIGN KEY (member_id) REFERENCES members(id)
  );
`);

/* =========================
   AUTH MIGRATION
========================= */

try {
  db.prepare(
    "ALTER TABLE members ADD COLUMN email TEXT"
  ).run();
} catch {}

try {
  db.prepare(
    "ALTER TABLE members ADD COLUMN password_hash TEXT"
  ).run();
} catch {}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_members_email
  ON members(email)
  WHERE email IS NOT NULL;
`);

/* =========================
   REGISTERED USERS ONLY
========================= */

/*
  Older versions of TeamPulse created
  placeholder members without accounts.

  TeamPulse now uses real accounts only.

  Any member without both:
    - email
    - password_hash

  is considered an old/unregistered placeholder
  and is removed automatically.
*/

const cleanupUnregisteredMembers = db.transaction(() => {
  const unregisteredMembers = db
    .prepare(`
      SELECT id
      FROM members
      WHERE email IS NULL
         OR password_hash IS NULL
    `)
    .all();

  if (unregisteredMembers.length === 0) {
    return;
  }

  const ids = unregisteredMembers.map(
    (member) => member.id
  );

  const placeholders = ids
    .map(() => "?")
    .join(", ");

  db.prepare(`
    DELETE FROM weekly_admin
    WHERE member_id IN (${placeholders})
  `).run(...ids);

  db.prepare(`
    DELETE FROM tasks
    WHERE assignee_id IN (${placeholders})
       OR created_by IN (${placeholders})
  `).run(...ids, ...ids);

  db.prepare(`
    DELETE FROM members
    WHERE id IN (${placeholders})
  `).run(...ids);

  console.log(
    `Removed ${ids.length} unregistered member(s).`
  );
});

cleanupUnregisteredMembers();

/* =========================
   HELPERS
========================= */

function sanitizeName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function getInitials(name) {
  return sanitizeName(name)
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getPoints(priority) {
  if (priority === "High") return 30;
  if (priority === "Medium") return 20;
  return 10;
}

function isValidPriority(priority) {
  return ["Low", "Medium", "High"].includes(priority);
}

function isValidStatus(status) {
  return [
    "Pending",
    "In Progress",
    "Completed",
  ].includes(status);
}

function getPublicMember(member) {
  if (!member) return null;

  return {
    id: member.id,
    name: member.name,
    role: member.role,
    initials: member.initials,
    points: member.points,
    email: member.email || null,
  };
}

function generateToken(member) {
  return jwt.sign(
    {
      id: member.id,
    },
    JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
}

/* =========================
   AUTHENTICATION
========================= */

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (
    !authHeader ||
    !authHeader.startsWith("Bearer ")
  ) {
    return res.status(401).json({
      message: "Authentication required",
    });
  }

  const token = authHeader
    .substring(7)
    .trim();

  if (!token) {
    return res.status(401).json({
      message: "Authentication required",
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    const member = db
      .prepare(`
        SELECT
          id,
          name,
          role,
          initials,
          points,
          email
        FROM members
        WHERE id = ?
          AND email IS NOT NULL
          AND password_hash IS NOT NULL
      `)
      .get(decoded.id);

    if (!member) {
      return res.status(401).json({
        message: "User no longer exists",
      });
    }

    req.user = member;

    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
}

/* =========================
   WEEK FUNCTIONS
========================= */

function getCurrentWeek() {
  const today = new Date();

  const day = today.getDay();
  const diff =
    day === 0
      ? -6
      : 1 - day;

  const monday = new Date(today);

  monday.setDate(
    today.getDate() + diff
  );

  monday.setHours(
    0,
    0,
    0,
    0
  );

  const sunday = new Date(monday);

  sunday.setDate(
    monday.getDate() + 6
  );

  sunday.setHours(
    23,
    59,
    59,
    999
  );

  return {
    start: monday.toISOString(),
    end: sunday.toISOString(),
  };
}

function getCurrentAdmin() {
  const week = getCurrentWeek();

  let admin = db
    .prepare(`
      SELECT
        weekly_admin.id,
        weekly_admin.member_id,
        weekly_admin.week_start,
        weekly_admin.week_end,
        members.name,
        members.role,
        members.initials,
        members.points
      FROM weekly_admin
      JOIN members
        ON members.id = weekly_admin.member_id
      WHERE weekly_admin.week_start = ?
        AND members.email IS NOT NULL
        AND members.password_hash IS NOT NULL
      LIMIT 1
    `)
    .get(week.start);

  if (admin) {
    return admin;
  }

  const members = db
    .prepare(`
      SELECT *
      FROM members
      WHERE email IS NOT NULL
        AND password_hash IS NOT NULL
      ORDER BY id ASC
    `)
    .all();

  if (members.length === 0) {
    return null;
  }

  const previousAdmin = db
    .prepare(`
      SELECT member_id
      FROM weekly_admin
      ORDER BY id DESC
      LIMIT 1
    `)
    .get();

  let nextMember;

  if (!previousAdmin) {
    nextMember = members[0];
  } else {
    const currentIndex =
      members.findIndex(
        (member) =>
          member.id ===
          previousAdmin.member_id
      );

    const nextIndex =
      currentIndex === -1
        ? 0
        : (currentIndex + 1) %
          members.length;

    nextMember = members[nextIndex];
  }

  db.prepare(`
    INSERT INTO weekly_admin
    (
      member_id,
      week_start,
      week_end
    )
    VALUES (?, ?, ?)
  `).run(
    nextMember.id,
    week.start,
    week.end
  );

  return db
    .prepare(`
      SELECT
        weekly_admin.id,
        weekly_admin.member_id,
        weekly_admin.week_start,
        weekly_admin.week_end,
        members.name,
        members.role,
        members.initials,
        members.points
      FROM weekly_admin
      JOIN members
        ON members.id = weekly_admin.member_id
      WHERE weekly_admin.week_start = ?
      LIMIT 1
    `)
    .get(week.start);
}

function requireWeeklyAdmin(
  req,
  res,
  next
) {
  const admin = getCurrentAdmin();

  if (!admin) {
    return res.status(403).json({
      message:
        "No weekly admin is available",
    });
  }

  if (
    admin.member_id !==
    req.user.id
  ) {
    return res.status(403).json({
      message:
        "Only the current weekly admin can perform this action",
    });
  }

  next();
}

/* =========================
   BASIC
========================= */

app.get("/", (req, res) => {
  res.json({
    message:
      "TeamPulse API is running",
    status: "ok",
  });
});

/* =========================
   AUTH - REGISTER
========================= */

app.post(
  "/api/auth/register",
  async (req, res) => {
    try {
      const name =
        sanitizeName(req.body.name);

      const email =
        normalizeEmail(req.body.email);

      const password =
        String(
          req.body.password || ""
        );

      if (
        !name ||
        !email ||
        !password
      ) {
        return res.status(400).json({
          message:
            "Name, email and password are required",
        });
      }

      if (
        name.length < 2 ||
        name.length > 50
      ) {
        return res.status(400).json({
          message:
            "Name must be between 2 and 50 characters",
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          message:
            "Password must be at least 6 characters",
        });
      }

      if (
        !email.includes("@")
      ) {
        return res.status(400).json({
          message:
            "Please enter a valid email",
        });
      }

      const existingEmail =
        db.prepare(`
          SELECT id
          FROM members
          WHERE email = ?
        `).get(email);

      if (existingEmail) {
        return res.status(409).json({
          message:
            "Email already registered",
        });
      }

      const existingMember =
        db.prepare(`
          SELECT *
          FROM members
          WHERE name = ?
        `).get(name);

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      let member;

      /*
        This branch supports an old database
        where a placeholder member with the
        same name still exists.
      */

      if (
        existingMember &&
        !existingMember.password_hash
      ) {
        db.prepare(`
          UPDATE members
          SET
            email = ?,
            password_hash = ?
          WHERE id = ?
        `).run(
          email,
          passwordHash,
          existingMember.id
        );

        member =
          db.prepare(`
            SELECT
              id,
              name,
              role,
              initials,
              points,
              email
            FROM members
            WHERE id = ?
          `).get(
            existingMember.id
          );
      } else if (
        existingMember
      ) {
        return res.status(409).json({
          message:
            "Name already exists",
        });
      } else {
        const initials =
          getInitials(name);

        const result =
          db.prepare(`
            INSERT INTO members
            (
              name,
              role,
              initials,
              points,
              email,
              password_hash
            )
            VALUES (?, ?, ?, 0, ?, ?)
          `).run(
            name,
            "Team Member",
            initials,
            email,
            passwordHash
          );

        member =
          db.prepare(`
            SELECT
              id,
              name,
              role,
              initials,
              points,
              email
            FROM members
            WHERE id = ?
          `).get(
            result.lastInsertRowid
          );
      }

      const token =
        generateToken(member);

      return res.status(201).json({
        message:
          "Registration successful",
        token,
        user:
          getPublicMember(member),
      });
    } catch (error) {
      console.error(
        "Register error:",
        error
      );

      return res.status(500).json({
        message:
          "Registration failed",
      });
    }
  }
);

/* =========================
   AUTH - LOGIN
========================= */

app.post(
  "/api/auth/login",
  async (req, res) => {
    try {
      const email =
        normalizeEmail(
          req.body.email
        );

      const password =
        String(
          req.body.password || ""
        );

      if (
        !email ||
        !password
      ) {
        return res.status(400).json({
          message:
            "Email and password are required",
        });
      }

      const member =
        db.prepare(`
          SELECT
            id,
            name,
            role,
            initials,
            points,
            email,
            password_hash
          FROM members
          WHERE email = ?
        `).get(email);

      if (
        !member ||
        !member.password_hash
      ) {
        return res.status(401).json({
          message:
            "Invalid email or password",
        });
      }

      const passwordMatch =
        await bcrypt.compare(
          password,
          member.password_hash
        );

      if (!passwordMatch) {
        return res.status(401).json({
          message:
            "Invalid email or password",
        });
      }

      const user =
        getPublicMember(member);

      const token =
        generateToken(user);

      return res.json({
        message:
          "Login successful",
        token,
        user,
      });
    } catch (error) {
      console.error(
        "Login error:",
        error
      );

      return res.status(500).json({
        message:
          "Login failed",
      });
    }
  }
);

/* =========================
   AUTH - CURRENT USER
========================= */

app.get(
  "/api/auth/me",
  authenticateToken,
  (req, res) => {
    res.json({
      user:
        getPublicMember(
          req.user
        ),
    });
  }
);

/* =========================
   MEMBERS
========================= */

/*
  IMPORTANT:
  Only users with a real account
  can appear in TeamPulse.
*/

app.get(
  "/api/members",
  authenticateToken,
  (req, res) => {
    const members =
      db.prepare(`
        SELECT
          id,
          name,
          role,
          initials,
          points,
          email
        FROM members
        WHERE email IS NOT NULL
          AND password_hash IS NOT NULL
        ORDER BY points DESC, name ASC
      `).all();

    res.json(members);
  }
);

/*
  There is intentionally NO
  POST /api/members endpoint.

  New members must create real accounts
  through /api/auth/register.
*/

/* =========================
   CURRENT ADMIN
========================= */

app.get(
  "/api/admin/current",
  authenticateToken,
  (req, res) => {
    const admin =
      getCurrentAdmin();

    if (!admin) {
      return res.status(404).json({
        message:
          "No admin available",
      });
    }

    res.json({
      id: admin.member_id,
      name: admin.name,
      role: admin.role,
      initials: admin.initials,
      points: admin.points,
      weekStart:
        admin.week_start,
      weekEnd:
        admin.week_end,
    });
  }
);

/* =========================
   LEADERBOARD
========================= */

app.get(
  "/api/leaderboard",
  authenticateToken,
  (req, res) => {
    const leaderboard =
      db.prepare(`
        SELECT
          id,
          name,
          role,
          initials,
          points
        FROM members
        WHERE email IS NOT NULL
          AND password_hash IS NOT NULL
        ORDER BY points DESC, name ASC
      `).all();

    const result =
      leaderboard.map(
        (member, index) => ({
          rank: index + 1,
          ...member,
        })
      );

    res.json(result);
  }
);

/* =========================
   TASKS - ALL
========================= */

app.get(
  "/api/tasks",
  authenticateToken,
  (req, res) => {
    const tasks =
      db.prepare(`
        SELECT
          tasks.id,
          tasks.title,
          tasks.status,
          tasks.priority,
          tasks.points,
          tasks.points_awarded,
          tasks.created_at,
          tasks.completed_at,
          tasks.created_by,
          tasks.assignee_id,
          COALESCE(
            members.name,
            'Unassigned'
          ) AS assignee
        FROM tasks
        LEFT JOIN members
          ON members.id =
             tasks.assignee_id
        ORDER BY tasks.id DESC
      `).all();

    res.json(
      tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        points: task.points,
        pointsAwarded:
          task.points_awarded,
        createdAt:
          task.created_at,
        completedAt:
          task.completed_at,
        createdBy:
          task.created_by,
        assignee:
          task.assignee,
        assigneeId:
          task.assignee_id,
      }))
    );
  }
);

/* =========================
   TASKS - MY
========================= */

app.get(
  "/api/tasks/my",
  authenticateToken,
  (req, res) => {
    const tasks =
      db.prepare(`
        SELECT
          tasks.id,
          tasks.title,
          tasks.status,
          tasks.priority,
          tasks.points,
          tasks.points_awarded,
          tasks.created_at,
          tasks.completed_at,
          tasks.created_by,
          tasks.assignee_id,
          COALESCE(
            members.name,
            'Unassigned'
          ) AS assignee
        FROM tasks
        LEFT JOIN members
          ON members.id =
             tasks.assignee_id
        WHERE tasks.assignee_id = ?
        ORDER BY tasks.id DESC
      `).all(req.user.id);

    res.json(
      tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        points: task.points,
        pointsAwarded:
          task.points_awarded,
        createdAt:
          task.created_at,
        completedAt:
          task.completed_at,
        createdBy:
          task.created_by,
        assignee:
          task.assignee,
        assigneeId:
          task.assignee_id,
      }))
    );
  }
);

/* =========================
   CREATE TASK
========================= */

app.post(
  "/api/tasks",
  authenticateToken,
  requireWeeklyAdmin,
  (req, res) => {
    const title =
      String(
        req.body.title || ""
      ).trim();

    const priority =
      req.body.priority ||
      "Medium";

    const assignee =
      req.body.assignee ||
      "Unassigned";

    if (!title) {
      return res.status(400).json({
        message:
          "Task title is required",
      });
    }

    if (title.length > 200) {
      return res.status(400).json({
        message:
          "Task title is too long",
      });
    }

    if (
      !isValidPriority(priority)
    ) {
      return res.status(400).json({
        message:
          "Invalid priority",
      });
    }

    const points =
      getPoints(priority);

    let assigneeId = null;

    if (
      assignee !== "Unassigned"
    ) {
      const member =
        db.prepare(`
          SELECT id
          FROM members
          WHERE name = ?
            AND email IS NOT NULL
            AND password_hash IS NOT NULL
        `).get(
          sanitizeName(
            assignee
          )
        );

      if (!member) {
        return res.status(400).json({
          message:
            "Assignee not found",
        });
      }

      assigneeId =
        member.id;
    }

    const creatorId =
      req.user.id;

    const result =
      db.prepare(`
        INSERT INTO tasks
        (
          title,
          status,
          priority,
          assignee_id,
          created_by,
          points
        )
        VALUES (
          ?,
          'Pending',
          ?,
          ?,
          ?,
          ?
        )
      `).run(
        title,
        priority,
        assigneeId,
        creatorId,
        points
      );

    const task =
      db.prepare(`
        SELECT
          tasks.id,
          tasks.title,
          tasks.status,
          tasks.priority,
          tasks.points,
          tasks.points_awarded,
          tasks.created_at,
          tasks.created_by,
          tasks.assignee_id,
          COALESCE(
            members.name,
            'Unassigned'
          ) AS assignee
        FROM tasks
        LEFT JOIN members
          ON members.id =
             tasks.assignee_id
        WHERE tasks.id = ?
      `).get(
        result.lastInsertRowid
      );

    return res.status(201).json({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      points: task.points,
      pointsAwarded:
        task.points_awarded,
      createdAt:
        task.created_at,
      createdBy:
        task.created_by,
      assignee:
        task.assignee,
      assigneeId:
        task.assignee_id,
    });
  }
);

/* =========================
   UPDATE TASK
========================= */

app.patch(
  "/api/tasks/:id",
  authenticateToken,
  (req, res) => {
    const taskId =
      Number(req.params.id);

    if (
      !Number.isInteger(taskId)
    ) {
      return res.status(400).json({
        message:
          "Invalid task ID",
      });
    }

    const task =
      db.prepare(`
        SELECT *
        FROM tasks
        WHERE id = ?
      `).get(taskId);

    if (!task) {
      return res.status(404).json({
        message:
          "Task not found",
      });
    }

    const isAdmin =
      getCurrentAdmin()
        ?.member_id ===
      req.user.id;

    const isAssignee =
      task.assignee_id ===
      req.user.id;

    if (
      !isAdmin &&
      !isAssignee
    ) {
      return res.status(403).json({
        message:
          "You are not allowed to update this task",
      });
    }

    const requestedStatus =
      req.body.status !==
      undefined
        ? req.body.status
        : task.status;

    const requestedPriority =
      req.body.priority !==
      undefined
        ? req.body.priority
        : task.priority;

    if (
      !isValidStatus(
        requestedStatus
      )
    ) {
      return res.status(400).json({
        message:
          "Invalid task status",
      });
    }

    if (
      !isValidPriority(
        requestedPriority
      )
    ) {
      return res.status(400).json({
        message:
          "Invalid task priority",
      });
    }

    if (!isAdmin) {
      if (
        req.body.priority !==
          undefined ||
        req.body.assignee !==
          undefined
      ) {
        return res.status(403).json({
          message:
            "Only the weekly admin can change task assignment or priority",
        });
      }
    }

    let assigneeId =
      task.assignee_id;

    if (
      isAdmin &&
      req.body.assignee !==
        undefined
    ) {
      const requestedAssignee =
        String(
          req.body.assignee
        ).trim();

      if (
        !requestedAssignee ||
        requestedAssignee ===
          "Unassigned"
      ) {
        assigneeId = null;
      } else {
        const member =
          db.prepare(`
            SELECT id
            FROM members
            WHERE name = ?
              AND email IS NOT NULL
              AND password_hash IS NOT NULL
          `).get(
            requestedAssignee
          );

        if (!member) {
          return res.status(400).json({
            message:
              "Assignee not found",
          });
        }

        assigneeId =
          member.id;
      }
    }

    const newPoints =
      getPoints(
        requestedPriority
      );

    const becameCompleted =
      task.status !==
        "Completed" &&
      requestedStatus ===
        "Completed";

    const becameIncomplete =
      task.status ===
        "Completed" &&
      requestedStatus !==
        "Completed";

    const assignmentChanged =
      task.assignee_id !==
      assigneeId;

    const transaction =
      db.transaction(() => {
        /*
          Remove points from previous
          assignee when completed task
          is moved to another person.
        */

        if (
          task.points_awarded &&
          assignmentChanged &&
          task.assignee_id
        ) {
          db.prepare(`
            UPDATE members
            SET points =
              MAX(
                0,
                points - ?
              )
            WHERE id = ?
          `).run(
            task.points,
            task.assignee_id
          );
        }

        /*
          Completed task assigned
          to a new member.
        */

        if (
          task.points_awarded &&
          assignmentChanged &&
          requestedStatus ===
            "Completed" &&
          assigneeId
        ) {
          db.prepare(`
            UPDATE members
            SET points =
              points + ?
            WHERE id = ?
          `).run(
            newPoints,
            assigneeId
          );
        }

        /*
          Task becomes completed
          for the first time.
        */

        if (
          becameCompleted &&
          !task.points_awarded &&
          assigneeId
        ) {
          db.prepare(`
            UPDATE members
            SET points =
              points + ?
            WHERE id = ?
          `).run(
            newPoints,
            assigneeId
          );
        }

        /*
          Completed task becomes
          incomplete.
        */

        if (
          becameIncomplete &&
          task.points_awarded &&
          task.assignee_id
        ) {
          db.prepare(`
            UPDATE members
            SET points =
              MAX(
                0,
                points - ?
              )
            WHERE id = ?
          `).run(
            task.points,
            task.assignee_id
          );
        }

        let pointsAwarded =
          task.points_awarded;

        if (
          requestedStatus !==
          "Completed"
        ) {
          pointsAwarded = 0;
        } else if (
          assigneeId
        ) {
          pointsAwarded = 1;
        } else {
          pointsAwarded = 0;
        }

        db.prepare(`
          UPDATE tasks
          SET
            status = ?,
            priority = ?,
            assignee_id = ?,
            points = ?,
            points_awarded = ?,
            completed_at = ?
          WHERE id = ?
        `).run(
          requestedStatus,
          requestedPriority,
          assigneeId,
          newPoints,
          pointsAwarded,
          requestedStatus ===
            "Completed"
            ? (
                task.completed_at ||
                new Date().toISOString()
              )
            : null,
          task.id
        );
      });

    transaction();

    const updatedTask =
      db.prepare(`
        SELECT
          tasks.id,
          tasks.title,
          tasks.status,
          tasks.priority,
          tasks.points,
          tasks.points_awarded,
          tasks.created_at,
          tasks.completed_at,
          tasks.created_by,
          tasks.assignee_id,
          COALESCE(
            members.name,
            'Unassigned'
          ) AS assignee
        FROM tasks
        LEFT JOIN members
          ON members.id =
             tasks.assignee_id
        WHERE tasks.id = ?
      `).get(task.id);

    return res.json({
      id: updatedTask.id,
      title: updatedTask.title,
      status:
        updatedTask.status,
      priority:
        updatedTask.priority,
      points:
        updatedTask.points,
      pointsAwarded:
        updatedTask.points_awarded,
      createdAt:
        updatedTask.created_at,
      completedAt:
        updatedTask.completed_at,
      createdBy:
        updatedTask.created_by,
      assignee:
        updatedTask.assignee,
      assigneeId:
        updatedTask.assignee_id,
    });
  }
);

/* =========================
   DELETE TASK
========================= */

app.delete(
  "/api/tasks/:id",
  authenticateToken,
  requireWeeklyAdmin,
  (req, res) => {
    const taskId =
      Number(req.params.id);

    if (
      !Number.isInteger(taskId)
    ) {
      return res.status(400).json({
        message:
          "Invalid task ID",
      });
    }

    const task =
      db.prepare(`
        SELECT *
        FROM tasks
        WHERE id = ?
      `).get(taskId);

    if (!task) {
      return res.status(404).json({
        message:
          "Task not found",
      });
    }

    const transaction =
      db.transaction(() => {
        if (
          task.points_awarded &&
          task.assignee_id
        ) {
          db.prepare(`
            UPDATE members
            SET points =
              MAX(
                0,
                points - ?
              )
            WHERE id = ?
          `).run(
            task.points,
            task.assignee_id
          );
        }

        db.prepare(`
          DELETE FROM tasks
          WHERE id = ?
        `).run(task.id);
      });

    transaction();

    res.json({
      message:
        "Task deleted",
    });
  }
);

/* =========================
   STATS
========================= */

app.get(
  "/api/stats",
  authenticateToken,
  (req, res) => {
    const members =
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM members
        WHERE email IS NOT NULL
          AND password_hash IS NOT NULL
      `).get().count;

    const totalTasks =
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM tasks
      `).get().count;

    const activeTasks =
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM tasks
        WHERE status != 'Completed'
      `).get().count;

    const completed =
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM tasks
        WHERE status = 'Completed'
      `).get().count;

    const totalPoints =
      db.prepare(`
        SELECT
          COALESCE(
            SUM(points),
            0
          ) AS points
        FROM members
        WHERE email IS NOT NULL
          AND password_hash IS NOT NULL
      `).get().points;

    res.json({
      members,
      totalTasks,
      activeTasks,
      completed,
      totalPoints,
    });
  }
);

/* =========================
   ERROR HANDLER
========================= */

app.use(
  (
    err,
    req,
    res,
    next
  ) => {
    console.error(
      "Unhandled server error:",
      err
    );

    res.status(500).json({
      message:
        "Internal server error",
    });
  }
);

/* =========================
   START SERVER
========================= */

app.listen(
  PORT,
  () => {
    console.log(
      `TeamPulse server running at http://localhost:${PORT}`
    );

    const admin =
      getCurrentAdmin();

    if (admin) {
      console.log(
        `Current weekly admin: ${admin.name}`
      );
    } else {
      console.log(
        "No registered users yet."
      );
    }
  }
);