
import { useEffect, useMemo, useState } from "react";
import "./App.css";

type Task = {
  id: number;
  title: string;
  status: "Pending" | "In Progress" | "Completed";
  priority: "High" | "Medium" | "Low";
  assignee: string;
  points: number;
  pointsAwarded?: number;
};

type Member = {
  id: number;
  name: string;
  role: string;
  initials: string;
  points: number;
};

type Admin = {
  id: number;
  name: string;
  role: string;
  initials: string;
  points: number;
  weekStart: string;
  weekEnd: string;
};

type LeaderboardMember = Member & {
  rank: number;
};

type User = {
  id: number;
  name: string;
  role?: string;
  initials?: string;
  points?: number;
  email?: string;
};

type Filter = "All" | "Pending" | "In Progress" | "Completed";

const API =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function getToken() {
  return localStorage.getItem("token");
}

function getAuthHeaders(): HeadersInit {
  const token = getToken();

  return token
    ? {
        Authorization: `Bearer ${token}`,
      }
    : {};
}

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const [authMode, setAuthMode] =
    useState<"login" | "register">("login");

  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [leaderboard, setLeaderboard] =
    useState<LeaderboardMember[]>([]);
  const [admin, setAdmin] = useState<Admin | null>(null);

  const [activePage, setActivePage] =
    useState("Dashboard");

  const [showModal, setShowModal] = useState(false);
  const [showMemberModal, setShowMemberModal] =
    useState(false);

  const [title, setTitle] = useState("");
  const [priority, setPriority] =
    useState<Task["priority"]>("Medium");
  const [assignee, setAssignee] =
    useState("Unassigned");

  const [memberName, setMemberName] = useState("");
  const [memberRole, setMemberRole] = useState("");

  const [taskFilter, setTaskFilter] =
    useState<Filter>("All");

  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isAdmin =
    admin?.id === currentUser?.id;

  const canUpdateTask = (task: Task) => {
    if (!currentUser) return false;

    return (
      isAdmin ||
      task.assignee === currentUser.name
    );
  };

  const checkAuth = async () => {
    const token = getToken();

    if (!token) {
      setCurrentUser(null);
      setAuthLoading(false);
      return;
    }

    try {
      const response = await fetch(
        `${API}/auth/me`,
        {
          headers: {
            ...getAuthHeaders(),
          },
        }
      );

      if (!response.ok) {
        localStorage.removeItem("token");
        localStorage.removeItem("teampulse_user");
        setCurrentUser(null);
        return;
      }

      const data = await response.json();

      const user = data.user;

      if (!user) {
        throw new Error("Invalid user session.");
      }

      setCurrentUser(user);

      localStorage.setItem(
        "teampulse_user",
        JSON.stringify(user)
      );
    } catch {
      localStorage.removeItem("token");
      localStorage.removeItem("teampulse_user");
      setCurrentUser(null);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAuth = async () => {
    setAuthError("");

    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError(
        "Please enter your email and password."
      );
      return;
    }

    if (
      authMode === "register" &&
      !authName.trim()
    ) {
      setAuthError("Please enter your name.");
      return;
    }

    if (
      authMode === "register" &&
      authPassword.length < 6
    ) {
      setAuthError(
        "Password must be at least 6 characters."
      );
      return;
    }

    try {
      setAuthLoading(true);

      const endpoint =
        authMode === "login"
          ? "/auth/login"
          : "/auth/register";

      const body =
        authMode === "login"
          ? {
              email: authEmail.trim(),
              password: authPassword,
            }
          : {
              name: authName.trim(),
              email: authEmail.trim(),
              password: authPassword,
            };

      const response = await fetch(
        `${API}${endpoint}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            "Authentication failed."
        );
      }

      if (!data.token) {
        throw new Error(
          "Authentication token was not returned."
        );
      }

      localStorage.setItem(
        "token",
        data.token
      );

      if (data.user) {
        localStorage.setItem(
          "teampulse_user",
          JSON.stringify(data.user)
        );
      }

      setAuthName("");
      setAuthEmail("");
      setAuthPassword("");
      setAuthError("");

      await checkAuth();
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : "Unable to authenticate."
      );
      setAuthLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("teampulse_user");

    setCurrentUser(null);
    setTasks([]);
    setMembers([]);
    setLeaderboard([]);
    setAdmin(null);
    setActivePage("Dashboard");
    setError("");
  };

  const loadData = async () => {
    if (!currentUser || !getToken()) {
      return;
    }

    try {
      setError("");
      setLoading(true);

      const headers = getAuthHeaders();

      const [
        tasksRes,
        membersRes,
        leaderboardRes,
        adminRes,
      ] = await Promise.all([
        fetch(`${API}/tasks`, {
          headers,
        }),
        fetch(`${API}/members`, {
          headers,
        }),
        fetch(`${API}/leaderboard`, {
          headers,
        }),
        fetch(`${API}/admin/current`, {
          headers,
        }),
      ]);

      const responses = [
        tasksRes,
        membersRes,
        leaderboardRes,
        adminRes,
      ];

      if (
        responses.some(
          (response) =>
            response.status === 401
        )
      ) {
        logout();
        setAuthError(
          "Your session expired. Please log in again."
        );
        return;
      }

      if (
        responses.some(
          (response) => !response.ok
        )
      ) {
        throw new Error(
          "Unable to load TeamPulse data."
        );
      }

      const [
        tasksData,
        membersData,
        leaderboardData,
        adminData,
      ] = await Promise.all([
        tasksRes.json(),
        membersRes.json(),
        leaderboardRes.json(),
        adminRes.json(),
      ]);

      setTasks(tasksData);
      setMembers(membersData);
      setLeaderboard(leaderboardData);
      setAdmin(adminData);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to connect to TeamPulse server."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (currentUser) {
      loadData();
    }
  }, [currentUser]);

  const stats = useMemo(() => {
    const completed = tasks.filter(
      (task) =>
        task.status === "Completed"
    ).length;

    const active = tasks.filter(
      (task) =>
        task.status !== "Completed"
    ).length;

    const completion =
      tasks.length > 0
        ? Math.round(
            (completed / tasks.length) *
              100
          )
        : 0;

    const userLeaderboardData =
      leaderboard.find(
        (member) =>
          member.id === currentUser?.id
      );

    return {
      total: tasks.length,
      active,
      completed,
      members: members.length,
      completion,
      totalPoints: members.reduce(
        (sum, member) =>
          sum + member.points,
        0
      ),
      userPoints:
        userLeaderboardData?.points ??
        currentUser?.points ??
        0,
      userRank:
        userLeaderboardData?.rank ??
        "-",
    };
  }, [
    tasks,
    members,
    leaderboard,
    currentUser,
  ]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const matchesFilter =
        taskFilter === "All" ||
        task.status === taskFilter;

      const searchText =
        search.toLowerCase().trim();

      const matchesSearch =
        !searchText ||
        task.title
          .toLowerCase()
          .includes(searchText) ||
        task.assignee
          .toLowerCase()
          .includes(searchText) ||
        task.priority
          .toLowerCase()
          .includes(searchText);

      return (
        matchesFilter &&
        matchesSearch
      );
    });
  }, [
    tasks,
    taskFilter,
    search,
  ]);

  const filterCounts = useMemo(() => {
    return {
      All: tasks.length,

      Pending: tasks.filter(
        (task) =>
          task.status === "Pending"
      ).length,

      "In Progress": tasks.filter(
        (task) =>
          task.status === "In Progress"
      ).length,

      Completed: tasks.filter(
        (task) =>
          task.status === "Completed"
      ).length,
    };
  }, [tasks]);

  const addTask = async () => {
    if (!isAdmin) {
      setError(
        "Only the current weekly admin can create and align tasks."
      );
      return;
    }

    if (!title.trim()) {
      setError("Please enter a task title.");
      return;
    }

    try {
      const response = await fetch(
        `${API}/tasks`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            title: title.trim(),
            priority,
            assignee,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            "Unable to create task."
        );
      }

      setTitle("");
      setPriority("Medium");
      setAssignee("Unassigned");
      setShowModal(false);

      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create task."
      );
    }
  };

  const updateStatus = async (
    task: Task
  ) => {
    if (!canUpdateTask(task)) {
      setError(
        "You can only update your own tasks."
      );
      return;
    }

    const nextStatus =
      task.status === "Pending"
        ? "In Progress"
        : task.status === "In Progress"
        ? "Completed"
        : "Pending";

    try {
      const response = await fetch(
        `${API}/tasks/${task.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            status: nextStatus,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            "Unable to update task."
        );
      }

      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to update task."
      );
    }
  };

  const deleteTask = async (
    id: number
  ) => {
    if (!isAdmin) {
      setError(
        "Only the current weekly admin can delete tasks."
      );
      return;
    }

    try {
      const response = await fetch(
        `${API}/tasks/${id}`,
        {
          method: "DELETE",
          headers: {
            ...getAuthHeaders(),
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            "Unable to delete task."
        );
      }

      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to delete task."
      );
    }
  };

  const addMember = async () => {
    if (!isAdmin) {
      setError(
        "Only the current weekly admin can add team members."
      );
      return;
    }

    if (
      !memberName.trim() ||
      !memberRole.trim()
    ) {
      setError(
        "Please enter member name and role."
      );
      return;
    }

    try {
      const response = await fetch(
        `${API}/members`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            name: memberName.trim(),
            role: memberRole.trim(),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            "Unable to add member."
        );
      }

      setMemberName("");
      setMemberRole("");
      setShowMemberModal(false);

      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to add member."
      );
    }
  };

  const openNewTask = () => {
    if (!isAdmin) {
      setError(
        `Only ${admin?.name || "the current weekly admin"} can create and align tasks.`
      );
      return;
    }

    setShowModal(true);
  };

  const openAdminPanel = () => {
    if (!isAdmin) {
      setError(
        `Admin access belongs to ${
          admin?.name ||
          "the current admin"
        } this week.`
      );
      return;
    }

    setActivePage("Admin Panel");
  };

  if (authLoading) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="logo auth-logo">
            <div className="logo-icon">
              T
            </div>
            <span>TeamPulse</span>
          </div>

          <div className="loading">
            <div className="loading-spinner"></div>
            <p>
              Checking your session...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        name={authName}
        setName={setAuthName}
        email={authEmail}
        setEmail={setAuthEmail}
        password={authPassword}
        setPassword={setAuthPassword}
        error={authError}
        loading={authLoading}
        onSubmit={handleAuth}
      />
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">
            T
          </div>

          <span>TeamPulse</span>
        </div>

        <div className="nav-section">
          <p>WORKSPACE</p>

          {[
            "Dashboard",
            "Tasks",
            "Team",
            "Leaderboard",
            "Admin Panel",
          ].map((item) => (
            <button
              key={item}
              className={`nav-item ${
                activePage === item
                  ? "active"
                  : ""
              }`}
              onClick={() => {
                if (
                  item === "Admin Panel"
                ) {
                  openAdminPanel();
                } else {
                  setActivePage(item);
                }
              }}
            >
              <span>
                {item === "Dashboard"
                  ? "⌂"
                  : item === "Tasks"
                  ? "✓"
                  : item === "Team"
                  ? "◉"
                  : item ===
                    "Leaderboard"
                  ? "🏆"
                  : "♛"}
              </span>

              {item}
            </button>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="profile">
            <div className="avatar">
              {currentUser.initials ||
                currentUser.name
                  .slice(0, 1)
                  .toUpperCase()}
            </div>

            <div>
              <strong>
                {currentUser.name}
              </strong>

              <small>
                {isAdmin
                  ? "Weekly Admin"
                  : currentUser.role ||
                    "Team Member"}
              </small>
            </div>
          </div>

          <button
            className="logout-button"
            onClick={logout}
          >
            Logout
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">
              TEAM WORKSPACE
            </p>

            <h2>{activePage}</h2>
          </div>

          <button
            className="add-button"
            onClick={openNewTask}
          >
            <span>+</span> New Task
          </button>
        </header>

        {error && (
          <div className="error-banner">
            <span>{error}</span>

            <button
              onClick={() => setError("")}
            >
              ×
            </button>
          </div>
        )}

        {loading ? (
          <div className="loading">
            <div className="loading-spinner"></div>
            <p>
              Loading TeamPulse...
            </p>
          </div>
        ) : (
          <>
            {activePage ===
              "Dashboard" && (
              <>
                <section className="hero">
                  <div>
                    <p className="hero-label">
                      GOOD TO SEE YOU,{" "}
                      {(
                        currentUser.name ||
                        "TEAM MEMBER"
                      ).toUpperCase()}
                    </p>

                    <h1>
                      Keep everyone moving
                      <br />
                      in the same direction.
                    </h1>

                    <p className="hero-text">
                      Align tasks, compete on
                      the leaderboard and build
                      momentum together.
                    </p>

                    {admin && (
                      <div className="admin-badge">
                        👑 {admin.name} is this
                        week's admin
                      </div>
                    )}
                  </div>

                  <div className="hero-shape">
                    <div className="pulse-line"></div>
                    <div className="pulse-dot"></div>
                  </div>
                </section>

                <section className="stats-grid">
                  <StatCard
                    label="Total Tasks"
                    value={stats.total}
                    icon="▦"
                  />

                  <StatCard
                    label="Completed"
                    value={
                      stats.completed
                    }
                    icon="✓"
                  />

                  <StatCard
                    label="My Points"
                    value={
                      stats.userPoints
                    }
                    icon="★"
                  />

                  <StatCard
                    label="My Rank"
                    value={stats.userRank}
                    icon="🏆"
                  />
                </section>

                <section className="content-grid">
                  <div className="panel tasks-panel">
                    <div className="panel-header">
                      <div>
                        <p className="panel-label">
                          WORK OVERVIEW
                        </p>

                        <h3>
                          Recent Tasks
                        </h3>
                      </div>

                      <button
                        className="text-button"
                        onClick={() =>
                          setActivePage(
                            "Tasks"
                          )
                        }
                      >
                        View all →
                      </button>
                    </div>

                    <TaskList
                      tasks={tasks.slice(
                        0,
                        5
                      )}
                      updateStatus={
                        updateStatus
                      }
                      deleteTask={
                        deleteTask
                      }
                      canUpdateTask={
                        canUpdateTask
                      }
                      isAdmin={isAdmin}
                    />
                  </div>

                  <div className="panel">
                    <div className="panel-header">
                      <div>
                        <p className="panel-label">
                          TEAM PERFORMANCE
                        </p>

                        <h3>
                          Progress
                        </h3>
                      </div>
                    </div>

                    <div className="progress-section">
                      <div className="progress-number">
                        <strong>
                          {
                            stats.completion
                          }
                          %
                        </strong>

                        <span>
                          completed
                        </span>
                      </div>

                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${stats.completion}%`,
                          }}
                        ></div>
                      </div>

                      <p className="progress-text">
                        {
                          stats.completed
                        }{" "}
                        of {stats.total} tasks
                        completed
                      </p>
                    </div>

                    <div className="admin-card">
                      <span>
                        WEEKLY ADMIN
                      </span>

                      <strong>
                        👑{" "}
                        {admin?.name ||
                          "Loading..."}
                      </strong>

                      <small>
                        {admin?.role ||
                          ""}
                      </small>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-header">
                      <div>
                        <p className="panel-label">
                          COMPETITION
                        </p>

                        <h3>
                          Top Performers
                        </h3>
                      </div>

                      <button
                        className="text-button"
                        onClick={() =>
                          setActivePage(
                            "Leaderboard"
                          )
                        }
                      >
                        Full board →
                      </button>
                    </div>

                    <MiniLeaderboard
                      leaderboard={leaderboard.slice(
                        0,
                        4
                      )}
                    />
                  </div>
                </section>
              </>
            )}

            {activePage === "Tasks" && (
              <section className="page-section">
                <div className="section-heading">
                  <div>
                    <p className="panel-label">
                      ALL WORK
                    </p>

                    <h1>Tasks</h1>
                  </div>

                  <button
                    className="add-button"
                    onClick={
                      openNewTask
                    }
                  >
                    + New Task
                  </button>
                </div>

                <div className="panel full-panel">
                  <div className="task-controls">
                    <div className="search-box">
                      <span>⌕</span>

                      <input
                        value={search}
                        onChange={(e) =>
                          setSearch(
                            e.target.value
                          )
                        }
                        placeholder="Search tasks..."
                      />

                      {search && (
                        <button
                          className="clear-search"
                          onClick={() =>
                            setSearch("")
                          }
                        >
                          ×
                        </button>
                      )}
                    </div>

                    <div className="filter-buttons">
                      {(
                        [
                          "All",
                          "Pending",
                          "In Progress",
                          "Completed",
                        ] as Filter[]
                      ).map(
                        (filter) => (
                          <button
                            key={filter}
                            className={
                              taskFilter ===
                              filter
                                ? "filter-button active"
                                : "filter-button"
                            }
                            onClick={() =>
                              setTaskFilter(
                                filter
                              )
                            }
                          >
                            {filter}

                            <span>
                              {
                                filterCounts[
                                  filter
                                ]
                              }
                            </span>
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  <TaskList
                    tasks={
                      filteredTasks
                    }
                    updateStatus={
                      updateStatus
                    }
                    deleteTask={
                      deleteTask
                    }
                    canUpdateTask={
                      canUpdateTask
                    }
                    isAdmin={isAdmin}
                  />
                </div>
              </section>
            )}

            {activePage === "Team" && (
              <section className="page-section">
                <div className="section-heading">
                  <div>
                    <p className="panel-label">
                      YOUR PEOPLE
                    </p>

                    <h1>Team</h1>
                  </div>

                  {isAdmin && (
                    <button
                      className="add-button"
                      onClick={() =>
                        setShowMemberModal(
                          true
                        )
                      }
                    >
                      + Add Member
                    </button>
                  )}
                </div>

                <div className="team-grid">
                  {members.map(
                    (member) => {
                      const memberTasks =
                        tasks.filter(
                          (task) =>
                            task.assignee ===
                            member.name
                        );

                      const completedTasks =
                        memberTasks.filter(
                          (task) =>
                            task.status ===
                            "Completed"
                        ).length;

                      return (
                        <div
                          className="member-card"
                          key={
                            member.id
                          }
                        >
                          <div className="big-avatar">
                            {
                              member.initials
                            }
                          </div>

                          <h3>
                            {member.name}
                          </h3>

                          <p>
                            {member.role}
                          </p>

                          {admin?.name ===
                            member.name && (
                            <span className="admin-tag">
                              👑 Weekly Admin
                            </span>
                          )}

                          <span className="online">
                            ● Available
                          </span>

                          <div className="member-points">
                            ⭐{" "}
                            {member.points}{" "}
                            points
                          </div>

                          <div className="member-stats">
                            <div>
                              <strong>
                                {
                                  memberTasks.length
                                }
                              </strong>

                              <span>
                                Tasks
                              </span>
                            </div>

                            <div>
                              <strong>
                                {
                                  completedTasks
                                }
                              </strong>

                              <span>
                                Done
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              </section>
            )}

            {activePage ===
              "Leaderboard" && (
              <section className="page-section">
                <div className="section-heading">
                  <div>
                    <p className="panel-label">
                      TEAM COMPETITION
                    </p>

                    <h1>
                      Leaderboard
                    </h1>
                  </div>
                </div>

                <div className="leaderboard-hero">
                  <div className="leaderboard-trophy">
                    🏆
                  </div>

                  <div>
                    <p>
                      TEAM LEADERBOARD
                    </p>

                    <h2>
                      Complete tasks. Earn
                      points.
                      <br />
                      Climb the board.
                    </h2>
                  </div>
                </div>

                <div className="panel leaderboard-panel">
                  {leaderboard.map(
                    (member) => (
                      <div
                        className={`leader-row ${
                          member.id ===
                          currentUser.id
                            ? "current-user"
                            : ""
                        }`}
                        key={
                          member.id
                        }
                      >
                        <div className="rank">
                          {member.rank ===
                          1
                            ? "🥇"
                            : member.rank ===
                              2
                            ? "🥈"
                            : member.rank ===
                              3
                            ? "🥉"
                            : `#${member.rank}`}
                        </div>

                        <div className="avatar">
                          {
                            member.initials
                          }
                        </div>

                        <div className="leader-info">
                          <strong>
                            {
                              member.name
                            }
                          </strong>

                          <span>
                            {
                              member.role
                            }
                          </span>
                        </div>

                        {admin?.name ===
                          member.name && (
                          <span className="admin-tag">
                            👑 Admin
                          </span>
                        )}

                        <strong className="leader-points">
                          ⭐{" "}
                          {
                            member.points
                          }
                        </strong>
                      </div>
                    )
                  )}
                </div>
              </section>
            )}

            {activePage ===
              "Admin Panel" && (
              <section className="page-section">
                <div className="section-heading">
                  <div>
                    <p className="panel-label">
                      MANAGEMENT
                    </p>

                    <h1>
                      Admin Panel
                    </h1>
                  </div>
                </div>

                {isAdmin ? (
                  <>
                    <div className="admin-dashboard">
                      <div className="admin-main-card">
                        <p className="panel-label">
                          CURRENT ADMIN
                        </p>

                        <div className="admin-profile">
                          <div className="big-avatar">
                            {
                              admin.initials
                            }
                          </div>

                          <div>
                            <h2>
                              {
                                admin.name
                              }
                            </h2>

                            <p>
                              {
                                admin.role
                              }
                            </p>
                          </div>

                          <span className="admin-status">
                            ACTIVE
                          </span>
                        </div>

                        <div className="admin-week">
                          <span>
                            Weekly
                            responsibility
                          </span>

                          <strong>
                            {formatDate(
                              admin.weekStart
                            )}
                            {" → "}
                            {formatDate(
                              admin.weekEnd
                            )}
                          </strong>
                        </div>
                      </div>

                      <div className="admin-action-card">
                        <span>
                          TEAM SIZE
                        </span>

                        <strong>
                          {
                            members.length
                          }
                        </strong>

                        <button
                          className="add-button"
                          onClick={() =>
                            setShowMemberModal(
                              true
                            )
                          }
                        >
                          + Add Member
                        </button>
                      </div>
                    </div>

                    <div className="panel admin-tasks">
                      <div className="panel-header">
                        <div>
                          <p className="panel-label">
                            ADMIN CONTROL
                          </p>

                          <h3>
                            Task Alignment
                          </h3>
                        </div>

                        <button
                          className="add-button"
                          onClick={() =>
                            setShowModal(
                              true
                            )
                          }
                        >
                          + Assign Task
                        </button>
                      </div>

                      <TaskList
                        tasks={tasks}
                        updateStatus={
                          updateStatus
                        }
                        deleteTask={
                          deleteTask
                        }
                        canUpdateTask={
                          canUpdateTask
                        }
                        isAdmin={isAdmin}
                      />
                    </div>
                  </>
                ) : (
                  <div className="locked-panel">
                    <div className="lock-icon">
                      🔒
                    </div>

                    <h2>
                      Admin access locked
                    </h2>

                    <p>
                      The current weekly
                      admin is{" "}
                      <strong>
                        {admin?.name}
                      </strong>
                      .
                    </p>

                    <span>
                      Admin responsibility
                      automatically rotates
                      every week.
                    </span>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>

      {showModal && (
        <div
          className="modal-overlay"
          onClick={() =>
            setShowModal(false)
          }
        >
          <div
            className="modal"
            onClick={(e) =>
              e.stopPropagation()
            }
          >
            <div className="modal-header">
              <div>
                <p className="panel-label">
                  CREATE
                </p>

                <h2>New Task</h2>
              </div>

              <button
                className="close"
                onClick={() =>
                  setShowModal(false)
                }
              >
                ×
              </button>
            </div>

            <label>
              Task title
            </label>

            <input
              value={title}
              onChange={(e) =>
                setTitle(e.target.value)
              }
              placeholder="What needs to be done?"
              autoFocus
            />

            <label>
              Priority
            </label>

            <select
              value={priority}
              onChange={(e) =>
                setPriority(
                  e.target.value as Task["priority"]
                )
              }
            >
              <option>
                High
              </option>

              <option>
                Medium
              </option>

              <option>
                Low
              </option>
            </select>

            <div className="points-preview">
              ⭐ This task is worth{" "}
              <strong>
                {priority === "High"
                  ? 30
                  : priority ===
                    "Medium"
                  ? 20
                  : 10}{" "}
                points
              </strong>
            </div>

            <label>
              Assign to
            </label>

            <select
              value={assignee}
              onChange={(e) =>
                setAssignee(
                  e.target.value
                )
              }
            >
              <option>
                Unassigned
              </option>

              {members.map(
                (member) => (
                  <option
                    key={member.id}
                    value={
                      member.name
                    }
                  >
                    {member.name}
                  </option>
                )
              )}
            </select>

            <button
              className="create-button"
              onClick={addTask}
            >
              Create Task
            </button>
          </div>
        </div>
      )}

      {showMemberModal && (
        <div
          className="modal-overlay"
          onClick={() =>
            setShowMemberModal(
              false
            )
          }
        >
          <div
            className="modal"
            onClick={(e) =>
              e.stopPropagation()
            }
          >
            <div className="modal-header">
              <div>
                <p className="panel-label">
                  TEAM
                </p>

                <h2>
                  Add Member
                </h2>
              </div>

              <button
                className="close"
                onClick={() =>
                  setShowMemberModal(
                    false
                  )
                }
              >
                ×
              </button>
            </div>

            <label>
              Member name
            </label>

            <input
              value={memberName}
              onChange={(e) =>
                setMemberName(
                  e.target.value
                )
              }
              placeholder="e.g. Arjun"
              autoFocus
            />

            <label>
              Role
            </label>

            <input
              value={memberRole}
              onChange={(e) =>
                setMemberRole(
                  e.target.value
                )
              }
              placeholder="e.g. Frontend Developer"
            />

            <button
              className="create-button"
              onClick={addMember}
            >
              Add Member
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AuthScreen({
  mode,
  setMode,
  name,
  setName,
  email,
  setEmail,
  password,
  setPassword,
  error,
  loading,
  onSubmit,
}: {
  mode: "login" | "register";
  setMode: (
    mode: "login" | "register"
  ) => void;
  name: string;
  setName: (
    value: string
  ) => void;
  email: string;
  setEmail: (
    value: string
  ) => void;
  password: string;
  setPassword: (
    value: string
  ) => void;
  error: string;
  loading: boolean;
  onSubmit: () => void;
}) {
  const [showPassword, setShowPassword] =
    useState(false);

  const switchMode = () => {
    setMode(
      mode === "login"
        ? "register"
        : "login"
    );
  };

  return (
    <div className="auth-screen">
      <div className="auth-layout">

        {/* LEFT BRANDING */}
        <div className="auth-brand">
          <div className="auth-brand-content">

            <div className="logo">
              <div className="logo-icon">
                T
              </div>

              <span>
                TeamPulse
              </span>
            </div>

            <div className="auth-brand-label">
              TEAM COLLABORATION PLATFORM
            </div>

            <h1>
              Keep your team
              <br />
              <span>in sync.</span>
            </h1>

            <p className="auth-brand-text">
              One workspace to manage tasks,
              track progress, compete on the
              leaderboard and keep everyone
              moving in the same direction.
            </p>

            <div className="auth-features">

              <div className="auth-feature">
                <span>✦</span>
                <div>
                  <strong>
                    Real Workspace
                  </strong>

                  <small>
                    Your data stays connected
                    to your account.
                  </small>
                </div>
              </div>

              <div className="auth-feature">
                <span>◈</span>
                <div>
                  <strong>
                    Team Momentum
                  </strong>

                  <small>
                    Tasks, points and progress
                    in one place.
                  </small>
                </div>
              </div>

              <div className="auth-feature">
                <span>♛</span>
                <div>
                  <strong>
                    Weekly Leadership
                  </strong>

                  <small>
                    Admin responsibility
                    rotates automatically.
                  </small>
                </div>
              </div>

            </div>

            <div className="auth-footer">
              <span className="auth-footer-dot"></span>
              Built for teams that move fast.
            </div>

          </div>
        </div>

        {/* RIGHT AUTH CARD */}
        <div className="auth-card">

          <div className="auth-card-top">
            <div className="auth-mini-logo">
              <div className="logo-icon">
                T
              </div>

              <span>
                TeamPulse
              </span>
            </div>

            <span className="secure-badge">
              ● SECURE
            </span>
          </div>

          <div className="auth-heading">

            <p className="panel-label">
              {mode === "login"
                ? "WELCOME BACK"
                : "GET STARTED"}
            </p>

            <h1>
              {mode === "login"
                ? "Welcome back."
                : "Join your team."}
            </h1>

            <p>
              {mode === "login"
                ? "Sign in to continue to your workspace."
                : "Create your TeamPulse account and get started."}
            </p>

          </div>

          {error && (
            <div className="error-banner auth-error">
              <span>
                {error}
              </span>
            </div>
          )}

          {mode === "register" && (
            <div className="auth-field">

              <label>
                Full name
              </label>

              <div className="input-wrapper">

                <span className="input-icon">
                  ◉
                </span>

                <input
                  value={name}
                  onChange={(e) =>
                    setName(
                      e.target.value
                    )
                  }
                  placeholder="Utkarsh Sharma"
                  autoComplete="name"
                />

              </div>

            </div>
          )}

          <div className="auth-field">

            <label>
              Email address
            </label>

            <div className="input-wrapper">

              <span className="input-icon">
                @
              </span>

              <input
                type="email"
                value={email}
                onChange={(e) =>
                  setEmail(
                    e.target.value
                  )
                }
                placeholder="you@example.com"
                autoComplete="email"
              />

            </div>

          </div>

          <div className="auth-field">

            <label>
              Password
            </label>

            <div className="input-wrapper">

              <span className="input-icon">
                ◇
              </span>

              <input
                type={
                  showPassword
                    ? "text"
                    : "password"
                }
                value={password}
                onChange={(e) =>
                  setPassword(
                    e.target.value
                  )
                }
                placeholder="Enter your password"
                autoComplete={
                  mode === "login"
                    ? "current-password"
                    : "new-password"
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onSubmit();
                  }
                }}
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() =>
                  setShowPassword(
                    !showPassword
                  )
                }
                title={
                  showPassword
                    ? "Hide password"
                    : "Show password"
                }
              >
                {showPassword
                  ? "◉"
                  : "○"}
              </button>

            </div>

            {mode === "register" && (
              <small className="password-hint">
                Minimum 6 characters
              </small>
            )}

          </div>

          <button
            className="create-button auth-submit"
            onClick={onSubmit}
            disabled={loading}
          >
            <span>
              {loading
                ? "Please wait..."
                : mode === "login"
                ? "Sign In"
                : "Create Account"}
            </span>

            {!loading && (
              <span className="auth-arrow">
                →
              </span>
            )}
          </button>

          <div className="auth-divider">
            <span></span>
            <small>
              TEAM WORKSPACE
            </small>
            <span></span>
          </div>

          <div className="auth-switch">
            <span>
              {mode === "login"
                ? "Don't have an account?"
                : "Already have an account?"}
            </span>

            <button
              type="button"
              onClick={switchMode}
            >
              {mode === "login"
                ? "Create account"
                : "Sign in"}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

function formatDate(
  date: string
) {
  return new Date(
    date
  ).toLocaleDateString(
    "en-IN",
    {
      day: "numeric",
      month: "short",
    }
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number | string;
  icon: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-icon">
        {icon}
      </div>

      <div>
        <p>{label}</p>

        <h2>{value}</h2>
      </div>
    </div>
  );
}

function TaskList({
  tasks,
  updateStatus,
  deleteTask,
  canUpdateTask,
  isAdmin,
}: {
  tasks: Task[];
  updateStatus: (
    task: Task
  ) => void;
  deleteTask: (
    id: number
  ) => void;
  canUpdateTask: (
    task: Task
  ) => boolean;
  isAdmin: boolean;
}) {
  if (tasks.length === 0) {
    return (
      <div className="empty">
        No matching tasks found.
      </div>
    );
  }

  return (
    <div className="task-list">
      {tasks.map((task) => {
        const canUpdate =
          canUpdateTask(task);

        return (
          <div
            className="task-row"
            key={task.id}
          >
            <button
              className={`status-dot ${task.status
                .toLowerCase()
                .replace(
                  " ",
                  "-"
                )}`}
              onClick={() => {
                if (canUpdate) {
                  updateStatus(
                    task
                  );
                }
              }}
              disabled={!canUpdate}
              title={
                canUpdate
                  ? "Change status"
                  : "Only the assignee or weekly admin can update this task"
              }
            >
              {task.status ===
              "Completed"
                ? "✓"
                : ""}
            </button>

            <div className="task-info">
              <strong>
                {task.title}
              </strong>

              <div className="task-meta">
                <span
                  className={`priority ${task.priority.toLowerCase()}`}
                >
                  {task.priority}
                </span>

                <span>
                  {task.assignee}
                </span>

                <span className="task-points">
                  ⭐ {task.points} pts
                </span>
              </div>
            </div>

            <span
              className={`status ${task.status
                .toLowerCase()
                .replace(
                  " ",
                  "-"
                )}`}
            >
              {task.status}
            </span>

            {isAdmin && (
              <button
                className="delete-button"
                onClick={() =>
                  deleteTask(
                    task.id
                  )
                }
                title="Delete task"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MiniLeaderboard({
  leaderboard,
}: {
  leaderboard: LeaderboardMember[];
}) {
  return (
    <div className="mini-leaderboard">
      {leaderboard.map(
        (member) => (
          <div
            className="mini-leader-row"
            key={member.id}
          >
            <strong>
              {member.rank === 1
                ? "🥇"
                : member.rank ===
                  2
                ? "🥈"
                : member.rank ===
                  3
                ? "🥉"
                : `#${member.rank}`}
            </strong>

            <div className="avatar">
              {member.initials}
            </div>

            <div>
              <strong>
                {member.name}
              </strong>

              <span>
                {member.points}{" "}
                points
              </span>
            </div>
          </div>
        )
      )}
    </div>
  );
}

export default App;
