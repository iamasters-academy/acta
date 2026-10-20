// Windows meeting detector. Prints the same JSON lines as the Mac helper's `detect`
// command so server/detector.ts can notify and auto-stop. Audio capture itself is
// not done here: the Electron shell uses Chromium's WASAPI loopback.
//
//   acta-audio.exe detect [--interval S]
//   acta-audio.exe check | devices | request | events | capture
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audiopolicy.h>
#include <tlhelp32.h>
#include <shellapi.h>

#include <stdio.h>
#include <string.h>

#include <algorithm>
#include <string>
#include <vector>

struct Meeting {
  std::string app;
  std::string id;
  std::string title;
};

static std::wstring lower(std::wstring s) {
  for (auto& c : s) c = (wchar_t)towlower(c);
  return s;
}

static bool has(const std::wstring& hay, const wchar_t* needle) {
  return lower(hay).find(lower(needle)) != std::wstring::npos;
}

static bool starts(const std::wstring& hay, const wchar_t* needle) {
  const std::wstring n = lower(needle);
  return lower(hay).compare(0, n.size(), n) == 0;
}

static std::string utf8(const std::wstring& w) {
  if (w.empty()) return "";
  int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  if (n <= 0) return "";
  std::string s((size_t)n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), s.data(), n, nullptr, nullptr);
  return s;
}

static std::string jsonEscape(const std::string& s) {
  std::string o;
  o.reserve(s.size() + 8);
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') {
      o.push_back('\\');
      o.push_back((char)c);
    } else if (c == '\n' || c == '\r' || c == '\t') {
      o += " ";
    } else if (c >= 0x20) {
      o.push_back((char)c);
    }
  }
  return o;
}

static std::wstring fileName(const std::wstring& path) {
  const auto p = path.find_last_of(L"\\/");
  return lower(p == std::wstring::npos ? path : path.substr(p + 1));
}

struct Proc {
  DWORD pid;
  std::wstring exe;
};

static std::vector<Proc> processes() {
  std::vector<Proc> out;
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return out;
  PROCESSENTRY32W pe;
  pe.dwSize = sizeof(pe);
  if (Process32FirstW(snap, &pe)) {
    do {
      out.push_back({pe.th32ProcessID, fileName(pe.szExeFile)});
    } while (Process32NextW(snap, &pe));
  }
  CloseHandle(snap);
  return out;
}

struct WinHit {
  DWORD pid;
  std::wstring title;
};

static BOOL CALLBACK collectWindow(HWND hwnd, LPARAM lp) {
  if (!IsWindowVisible(hwnd)) return TRUE;
  const int len = GetWindowTextLengthW(hwnd);
  if (len <= 0) return TRUE;
  std::wstring title((size_t)len + 1, L'\0');
  const int got = GetWindowTextW(hwnd, title.data(), len + 1);
  if (got <= 0) return TRUE;
  title.resize((size_t)got);
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  reinterpret_cast<std::vector<WinHit>*>(lp)->push_back({pid, title});
  return TRUE;
}

static bool isBrowser(const std::wstring& exe) {
  return exe == L"chrome.exe" || exe == L"msedge.exe" || exe == L"firefox.exe" || exe == L"brave.exe" ||
         exe == L"opera.exe" || exe == L"vivaldi.exe" || exe == L"chromium.exe";
}

static bool isZoom(const std::wstring& exe) { return exe == L"zoom.exe"; }

static bool isTeams(const std::wstring& exe) {
  return exe == L"ms-teams.exe" || exe == L"teams.exe" || exe == L"msteams.exe";
}

static bool isWebex(const std::wstring& exe) {
  return exe == L"ciscocollabhost.exe" || exe == L"webexhost.exe" || exe == L"atmgr.exe" || exe == L"webexmta.exe" ||
         exe == L"ciscowebexstart.exe";
}

static std::vector<Meeting> detectMeetings(const std::vector<Proc>& procs, const std::vector<WinHit>& wins) {
  std::vector<Meeting> out;
  auto seen = [&](const std::string& key) {
    for (const auto& m : out)
      if (m.app + m.title == key) return true;
    return false;
  };
  auto add = [&](const char* app, const std::wstring& exe, const std::wstring& title) {
    const std::string t = utf8(title);
    const std::string key = std::string(app) + t;
    if (seen(key)) return;
    out.push_back({app, utf8(exe), t});
  };

  for (const auto& w : wins) {
    std::wstring exe;
    for (const auto& p : procs)
      if (p.pid == w.pid) {
        exe = p.exe;
        break;
      }
    const std::wstring& t = w.title;
    if (isBrowser(exe)) {
      if (starts(t, L"Meet - ") || has(t, L"Google Meet") || has(t, L"meet.google.com")) add("Google Meet", exe, t);
      else if (has(t, L"Microsoft Teams") && (has(t, L"Meeting") || has(t, L"Reunión") || has(t, L"Call") || has(t, L"Llamada")))
        add("Microsoft Teams", exe, t);
      else if (has(t, L"Whereby")) add("Whereby", exe, t);
      else if (has(t, L"Riverside")) add("Riverside", exe, t);
      else if (has(t, L"Zoom Meeting") || (has(t, L"Zoom Workplace") && has(t, L"Meeting"))) add("Zoom", exe, t);
    } else if (isZoom(exe)) {
      if (t == L"Zoom Meeting" || t == L"Zoom Webinar" || starts(t, L"Zoom Meeting") || has(t, L"Reunión de Zoom"))
        add("Zoom", exe, t);
    } else if (isTeams(exe)) {
      if (has(t, L"Meeting") || has(t, L"Reunión") || has(t, L"Call") || has(t, L"Llamada") || has(t, L"Meet now"))
        add("Microsoft Teams", exe, t);
    } else if (exe == L"slack.exe") {
      if (has(t, L"huddle")) add("Slack", exe, t);
    } else if (isWebex(exe)) {
      if (has(t, L"Meeting") || has(t, L"Reunión") || has(t, L"Call") || has(t, L"Llamada") || has(t, L"Webex"))
        add("Webex", exe, t);
    }
  }

  // Same idea as the Mac helper when window titles are unavailable: Zoom or Teams running is enough.
  if (out.empty() && wins.empty()) {
    for (const auto& p : procs) {
      if (isZoom(p.exe)) add("Zoom", p.exe, L"");
      else if (isTeams(p.exe)) add("Microsoft Teams", p.exe, L"");
    }
  }
  return out;
}

static bool micInUse(bool* ok) {
  *ok = false;
  const HRESULT init = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const bool uninit = init == S_OK || init == S_FALSE;
  if (FAILED(init) && init != RPC_E_CHANGED_MODE) return false;

  bool used = false;
  IMMDeviceEnumerator* enumerator = nullptr;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
  if (SUCCEEDED(hr) && enumerator) {
    const ERole roles[] = {eCommunications, eConsole};
    for (ERole role : roles) {
      IMMDevice* device = nullptr;
      if (FAILED(enumerator->GetDefaultAudioEndpoint(eCapture, role, &device)) || !device) continue;
      IAudioSessionManager2* manager = nullptr;
      hr = device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, (void**)&manager);
      device->Release();
      if (FAILED(hr) || !manager) continue;
      IAudioSessionEnumerator* sessions = nullptr;
      hr = manager->GetSessionEnumerator(&sessions);
      manager->Release();
      if (FAILED(hr) || !sessions) continue;
      *ok = true;
      int count = 0;
      sessions->GetCount(&count);
      for (int i = 0; i < count; i++) {
        IAudioSessionControl* ctrl = nullptr;
        if (FAILED(sessions->GetSession(i, &ctrl)) || !ctrl) continue;
        AudioSessionState state = AudioSessionStateInactive;
        ctrl->GetState(&state);
        IAudioSessionControl2* ctrl2 = nullptr;
        ctrl->QueryInterface(IID_PPV_ARGS(&ctrl2));
        DWORD pid = 0;
        HRESULT system = S_FALSE;
        if (ctrl2) {
          ctrl2->GetProcessId(&pid);
          system = ctrl2->IsSystemSoundsSession();
          ctrl2->Release();
        }
        ctrl->Release();
        if (state == AudioSessionStateActive && pid != 0 && pid != GetCurrentProcessId() && system != S_OK) used = true;
      }
      sessions->Release();
    }
    enumerator->Release();
  }
  if (uninit) CoUninitialize();
  return used;
}

static void printLine(const std::string& json) {
  fwrite(json.data(), 1, json.size(), stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

static void printDetect() {
  const auto procs = processes();
  std::vector<WinHit> wins;
  EnumWindows(collectWindow, reinterpret_cast<LPARAM>(&wins));
  const auto meetings = detectMeetings(procs, wins);
  bool micOk = false;
  bool mic = micInUse(&micOk);
  if (!micOk) mic = !meetings.empty();
  std::string json = std::string("{\"micInUse\":") + (mic ? "true" : "false") + ",\"meetings\":[";
  for (size_t i = 0; i < meetings.size(); i++) {
    if (i) json += ',';
    json += "{\"app\":\"" + jsonEscape(meetings[i].app) + "\",\"bundleId\":\"" + jsonEscape(meetings[i].id) +
            "\",\"title\":\"" + jsonEscape(meetings[i].title) + "\"}";
  }
  json += "],\"permissions\":{\"screen\":\"not-used\",\"mic\":\"prompt\",\"calendar\":\"not-used\"}}";
  printLine(json);
}

static std::wstring argAt(int argc, wchar_t** argv, int i) { return i < argc ? argv[i] : L""; }

int main() {
  int argc = 0;
  wchar_t** argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (!argv) return 1;
  const std::wstring cmd = argAt(argc, argv, 1);
  int code = 0;
  if (cmd == L"detect") {
    double interval = 2;
    for (int i = 2; i < argc; i++) {
      if (wcscmp(argv[i], L"--interval") == 0 && i + 1 < argc) interval = wcstod(argv[i + 1], nullptr);
    }
    if (interval < 0.5) interval = 2;
    for (;;) {
      printDetect();
      Sleep((DWORD)(interval * 1000));
    }
  } else if (cmd == L"check") {
    printLine("{\"mic\":\"prompt\",\"screen\":\"not-used\",\"calendar\":\"not-used\"}");
  } else if (cmd == L"devices" || cmd == L"events") {
    printLine("[]");
  } else if (cmd == L"request") {
    printLine("{}");
  } else if (cmd == L"capture") {
    fprintf(stderr, "En Windows el audio lo captura la ventana de Acta, no este programa.\n");
    code = 2;
  } else {
    fprintf(stderr, "uso: acta-audio detect|check|devices|request|events\n");
    code = 2;
  }
  LocalFree(argv);
  return code;
}
