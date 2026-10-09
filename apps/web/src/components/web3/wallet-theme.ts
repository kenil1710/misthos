import { lightTheme, type Theme } from "@rainbow-me/rainbowkit";

/**
 * RainbowKit in the Misthos palette. Every color is one of our CSS tokens, so the modal follows the app's own
 * light/dark switch (the `.dark` class on <html>), not just the system setting. Radius and font match the app.
 */
const base = lightTheme({ borderRadius: "medium", overlayBlur: "small" });

export const walletTheme: Theme = {
  ...base,
  colors: {
    ...base.colors,
    accentColor: "var(--primary)",
    accentColorForeground: "var(--primary-foreground)",
    actionButtonBorder: "var(--border)",
    actionButtonBorderMobile: "var(--border)",
    actionButtonSecondaryBackground: "var(--muted)",
    closeButton: "var(--muted-foreground)",
    closeButtonBackground: "var(--muted)",
    connectButtonBackground: "var(--card)",
    connectButtonBackgroundError: "var(--danger)",
    connectButtonInnerBackground: "var(--muted)",
    connectButtonText: "var(--foreground)",
    connectButtonTextError: "var(--primary-foreground)",
    connectionIndicator: "var(--success)",
    downloadBottomCardBackground: "var(--card)",
    downloadTopCardBackground: "var(--muted)",
    error: "var(--danger)",
    generalBorder: "var(--border)",
    generalBorderDim: "var(--border)",
    menuItemBackground: "var(--muted)",
    modalBackdrop: "color-mix(in oklab, black 45%, transparent)",
    modalBackground: "var(--popover)",
    modalBorder: "var(--border)",
    modalText: "var(--popover-foreground)",
    modalTextDim: "var(--muted-foreground)",
    modalTextSecondary: "var(--muted-foreground)",
    profileAction: "var(--muted)",
    profileActionHover: "var(--accent)",
    profileForeground: "var(--popover)",
    selectedOptionBorder: "var(--ring)",
    standby: "var(--warning)",
  },
  fonts: { body: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif" },
  radii: {
    actionButton: "calc(var(--radius) * 0.8)",
    connectButton: "calc(var(--radius) * 0.8)",
    menuButton: "calc(var(--radius) * 0.8)",
    modal: "calc(var(--radius) * 1.4)",
    modalMobile: "calc(var(--radius) * 1.4)",
  },
  shadows: {
    ...base.shadows,
    dialog: "var(--shadow-lift)",
    selectedOption: "none",
    selectedWallet: "none",
    walletLogo: "0 0 0 1px var(--border)",
  },
};
