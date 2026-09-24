import { ref } from "vue";
import { invoke } from "../ipc-bridge";
import type { SecuritySettings } from "../types";

export function useSecurity(
  onUnlockSuccess: () => Promise<void> | void,
  showToast: (msg: string) => void
) {
  const isAppLocked = ref(false);
  const securityConfig = ref<SecuritySettings>({ is_locked: false, password_hash: "", salt: "" });
  const unlockPasswordInput = ref("");
  const isUnlockFailed = ref(false);
  const newPasswordInput = ref("");
  const confirmPasswordInput = ref("");

  const deriveAuthAndSessionKey = async (
    password: string,
    salt: string
  ): Promise<{ authHash: string; sessionKeyHex: string }> => {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );
    const derivedBits = await window.crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: enc.encode(salt),
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      512
    );
    const u8 = new Uint8Array(derivedBits);
    const toHex = (arr: Uint8Array) =>
      Array.from(arr)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    return {
      authHash: toHex(u8.slice(0, 32)),
      sessionKeyHex: toHex(u8.slice(32, 64)),
    };
  };

  const generateSalt = (): string => {
    const arr = new Uint8Array(16);
    window.crypto.getRandomValues(arr);
    return Array.from(arr)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  };

  const handleUnlockApp = async () => {
    if (!unlockPasswordInput.value) return;
    const { authHash, sessionKeyHex } = await deriveAuthAndSessionKey(
      unlockPasswordInput.value,
      securityConfig.value.salt
    );
    if (authHash === securityConfig.value.password_hash) {
      try {
        await invoke("unlock_vault_session", { sessionKeyHex });
      } catch (err) {
        console.error("解密会话挂载失败:", err);
      }
      isAppLocked.value = false;
      unlockPasswordInput.value = "";
      isUnlockFailed.value = false;
      await onUnlockSuccess();
    } else {
      isUnlockFailed.value = true;
      unlockPasswordInput.value = "";
      setTimeout(() => {
        isUnlockFailed.value = false;
      }, 500);
    }
  };

  const handleSetPassword = async () => {
    if (!newPasswordInput.value || newPasswordInput.value !== confirmPasswordInput.value) {
      showToast("两次密码输入不一致");
      return;
    }
    const salt = generateSalt();
    const { authHash, sessionKeyHex } = await deriveAuthAndSessionKey(newPasswordInput.value, salt);
    await invoke("save_security_settings", {
      isLocked: true,
      passwordHash: authHash,
      salt,
      sessionKeyHex,
    });
    securityConfig.value = { is_locked: true, password_hash: authHash, salt };
    newPasswordInput.value = "";
    confirmPasswordInput.value = "";
    showToast("100,000 轮 PBKDF2 强加密会话已启用");
  };

  const handleDisablePassword = async () => {
    await invoke("save_security_settings", {
      isLocked: false,
      passwordHash: "",
      salt: "",
      sessionKeyHex: null,
    });
    securityConfig.value = { is_locked: false, password_hash: "", salt: "" };
    showToast("已关闭锁屏保护");
  };

  const lockAppNow = async () => {
    if (securityConfig.value.is_locked) {
      try {
        await invoke("lock_vault_session");
      } catch {}
      isAppLocked.value = true;
    }
  };

  const initSecurity = async (onUnlocked: () => Promise<void> | void) => {
    try {
      const sec = await invoke<SecuritySettings>("get_security_settings");
      securityConfig.value = sec;
      if (sec.is_locked) {
        isAppLocked.value = true;
      } else {
        await onUnlocked();
      }
    } catch {
      await onUnlocked();
    }
  };

  return {
    isAppLocked,
    securityConfig,
    unlockPasswordInput,
    isUnlockFailed,
    newPasswordInput,
    confirmPasswordInput,
    handleUnlockApp,
    handleSetPassword,
    handleDisablePassword,
    lockAppNow,
    initSecurity,
  };
}
