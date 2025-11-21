import {
    Add,
    Delete,
    Edit,
    NetworkCheck,
    Refresh,
    Save
} from "@mui/icons-material"
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Container,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    IconButton,
    InputLabel,
    List,
    ListItem,
    ListItemSecondaryAction,
    ListItemText,
    MenuItem,
    Paper,
    Select,
    Snackbar,
    Tab,
    Tabs,
    TextField,
    Typography
} from "@mui/material"
import type { SelectChangeEvent } from "@mui/material/Select"
import { useEffect, useState } from "react"

import generalSettingsService from "~general-settings-service"
import proxyRuleService from "~proxy-rule-service"
import requestMonitorService from "~request-monitor-service"
import { generateId } from "~utils/util"

import type { GeneralSettings, ProxyRule } from "../types/common"
import { PROXY_SCHEMES } from "../types/common"
import { t } from "../utils/i18n"

interface TabPanelProps {
    children?: React.ReactNode
    index: number
    value: number
}

function TabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props
    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`simple-tabpanel-${index}`}
            aria-labelledby={`simple-tab-${index}`}
            {...other}>
            {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
        </div>
    )
}

function Options() {
    const [tabValue, setTabValue] = useState(0)
    const [generalSettings, setGeneralSettings] = useState<GeneralSettings>({
        responseTimeThreshold: 5000,
        proxyServerAddress: "",
        proxyServerPort: 8080,
        proxyServerScheme: "http",
        proxyUsername: "",
        proxyPassword: ""
    })
    const [proxyRules, setProxyRules] = useState<ProxyRule[]>([])
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editingRule, setEditingRule] = useState<ProxyRule | null>(null)
    const [newRulePattern, setNewRulePattern] = useState("")
    const [snackbarOpen, setSnackbarOpen] = useState(false)
    const [snackbarMessage, setSnackbarMessage] = useState("")
    const [testDialogOpen, setTestDialogOpen] = useState(false)
    const [testTarget, setTestTarget] = useState("https://www.google.com")
    const [testResult, setTestResult] = useState<string | null>(null)
    const [testing, setTesting] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")

    // Load settings from storage on component mount
    useEffect(() => {
        const generalSettingSync = async () => {
            try {
                const generalSettings =
                    await generalSettingsService.getSettings()
                if (generalSettings) {
                    setGeneralSettings(generalSettings)
                }
            } catch (error) {
                console.error("Error loading settings:", error)
            }
        }
        generalSettingSync()
    }, [])

    useEffect(() => {
        proxyRuleService.getRules().then((rules) => setProxyRules(rules))
    }, [])

    const saveSettings = async () => {
        generalSettingsService
            .saveSettings(generalSettings)
            .then(() => {
                setSnackbarMessage(t("settingsSaved"))
                setSnackbarOpen(true)
            })
            .catch((error) => {
                console.error("Error saving settings:", error)
                setSnackbarMessage(t("saveSettingsFailed"))
                setSnackbarOpen(true)
            })
    }

    const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
        setTabValue(newValue)
    }

    const handleGeneralSettingChange =
        (field: keyof GeneralSettings) =>
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const value = event.target.value
            setGeneralSettings((prev) => ({
                ...prev,
                [field]:
                    field === "responseTimeThreshold" ||
                    field === "proxyServerPort"
                        ? parseInt(value) || 0
                        : value
            }))
        }

    const handleSchemeChange = (event: SelectChangeEvent) => {
        setGeneralSettings((prev) => ({
            ...prev,
            proxyServerScheme: event.target.value
        }))
    }
    const handleAddRule = () => {
        setEditingRule(null)
        setNewRulePattern("")
        setDialogOpen(true)
    }

    const handleEditRule = (rule: ProxyRule) => {
        setEditingRule(rule)
        setNewRulePattern(rule.pattern)
        setDialogOpen(true)
    }

    const handleDeleteRule = (id: string) => {
        proxyRuleService
            .deleteRule(id)
            .then((rules) => setProxyRules(rules))
            .finally(() => {
                requestMonitorService.configureSelectiveProxy()
            })
    }
    const handleSaveRule = () => {
        if (!newRulePattern.trim()) {
            setSnackbarMessage(t("enterRulePattern"))
            setSnackbarOpen(true)
            return
        }

        if (editingRule) {
            proxyRuleService
                .updateProxyRule(editingRule.id, {
                    pattern: newRulePattern
                })
                .then(() => {
                    proxyRuleService
                        .getRules()
                        .then((rules) => setProxyRules(rules))
                })
                .finally(() => {
                    requestMonitorService.configureSelectiveProxy()
                })
        } else {
            const exists = proxyRules.some(
                (rule) => rule.pattern === newRulePattern
            )
            if (exists) {
                return
            }
            // Add new rule
            const newRule: ProxyRule = {
                id: generateId(),
                pattern: newRulePattern
            }
            proxyRuleService
                .addRule(newRule)
                .then((rules) => setProxyRules(rules))
                .finally(() => {
                    requestMonitorService.configureSelectiveProxy()
                })
        }

        setDialogOpen(false)
        setNewRulePattern("")
        setEditingRule(null)
    }

    const handleCloseDialog = () => {
        setDialogOpen(false)
        setNewRulePattern("")
        setEditingRule(null)
    }

    const handleCloseSnackbar = () => {
        setSnackbarOpen(false)
    }

    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(event.target.value)
    }

    const filteredProxyRules = proxyRules.filter((rule) =>
        rule.pattern.toLowerCase().includes(searchTerm.toLowerCase())
    )

    const handleTestProxy = () => {
        setTestDialogOpen(true)
        setTestResult(null)
    }

    const handleCloseTestDialog = () => {
        setTestDialogOpen(false)
        setTestTarget("https://www.google.com")
        setTestResult(null)
    }

    const performProxyTest = async () => {
        if (
            !generalSettings.proxyServerAddress ||
            !generalSettings.proxyServerPort
        ) {
            setSnackbarMessage(t("configureProxyFirst"))
            setSnackbarOpen(true)
            return
        }

        setTesting(true)
        setTestResult(null)

        // Save original proxy settings
        let originalProxyConfig: chrome.proxy.ProxyConfig | null = null
        let authListener: ((details: any) => any) | null = null

        try {
            // Get current proxy configuration
            originalProxyConfig = await new Promise<chrome.proxy.ProxyConfig>(
                (resolve) => {
                    chrome.proxy.settings.get({}, (config) => {
                        resolve(config.value)
                    })
                }
            )

            // Construct test proxy configuration
            const testProxyConfig: chrome.proxy.ProxyConfig = {
                mode: "fixed_servers",
                rules: {
                    singleProxy: {
                        scheme: generalSettings.proxyServerScheme,
                        host: generalSettings.proxyServerAddress,
                        port: generalSettings.proxyServerPort
                    },
                    bypassList: ["<local>", "localhost", "127.0.0.1"]
                }
            }

            // Set up proxy authentication if credentials are provided
            if (
                generalSettings.proxyUsername &&
                generalSettings.proxyPassword
            ) {
                authListener = (
                    details: chrome.webRequest.WebAuthenticationChallengeDetails
                ) => {
                    if (
                        details.isProxy &&
                        details.challenger.host ===
                            generalSettings.proxyServerAddress
                    ) {
                        return {
                            authCredentials: {
                                username: generalSettings.proxyUsername,
                                password: generalSettings.proxyPassword
                            }
                        }
                    }
                    return {}
                }

                chrome.webRequest.onAuthRequired.addListener(
                    authListener,
                    { urls: ["<all_urls>"] },
                    ["blocking"]
                )
            }

            // Apply test proxy configuration
            await new Promise<void>((resolve, reject) => {
                chrome.proxy.settings.set(
                    { value: testProxyConfig, scope: "regular" },
                    () => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message))
                        } else {
                            resolve()
                        }
                    }
                )
            })

            // Wait a moment for proxy to take effect
            await new Promise((resolve) => setTimeout(resolve, 500))

            const startTime = Date.now()

            // Test connection through proxy using fetch
            const testPromise = new Promise<void>(async (resolve, reject) => {
                let settled = false
                const timeout = setTimeout(() => {
                    if (!settled) {
                        settled = true
                        reject(new Error(t("testTimeout")))
                    }
                }, 10000)

                try {
                    const response = await fetch(
                        testTarget + "/favicon.ico?" + Date.now(),
                        {
                            method: "GET",
                            cache: "no-store"
                        }
                    )

                    if (!settled) {
                        settled = true
                        clearTimeout(timeout)

                        // Accept any response (2xx, 4xx, 5xx) as success
                        // This means proxy connection works even if resource doesn't exist
                        if (response.status >= 200 && response.status < 600) {
                            resolve()
                        } else {
                            reject(new Error(`HTTP ${response.status}`))
                        }
                    }
                } catch (error) {
                    if (!settled) {
                        settled = true
                        clearTimeout(timeout)
                        reject(new Error(t("connectionFailed")))
                    }
                }
            })

            await testPromise
            const endTime = Date.now()
            const responseTime = endTime - startTime

            setTestResult(
                t("testSuccess", { responseTime: responseTime.toString() })
            )
            setSnackbarMessage(t("proxyTestSuccess"))
            setSnackbarOpen(true)
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : t("unknownError")
            setTestResult(t("testFailed", { error: errorMessage }))
            setSnackbarMessage(t("proxyTestFailed"))
            setSnackbarOpen(true)
        } finally {
            // Remove auth listener if it was added
            if (authListener) {
                chrome.webRequest.onAuthRequired.removeListener(authListener)
            }

            // Restore original proxy configuration
            if (originalProxyConfig) {
                try {
                    await new Promise<void>((resolve, reject) => {
                        chrome.proxy.settings.set(
                            { value: originalProxyConfig, scope: "regular" },
                            () => {
                                if (chrome.runtime.lastError) {
                                    reject(
                                        new Error(
                                            chrome.runtime.lastError.message
                                        )
                                    )
                                } else {
                                    resolve()
                                }
                            }
                        )
                    })
                } catch (restoreError) {
                    console.error(
                        "Failed to restore proxy settings:",
                        restoreError
                    )
                    setSnackbarMessage(t("failedToRestoreProxy"))
                    setSnackbarOpen(true)
                }
            }
            setTesting(false)
        }
    }

    return (
        <>
            <Container maxWidth="lg" sx={{ mt: 2, mb: 2 }}>
                <Paper elevation={2} sx={{ p: 2 }}>
                    <Typography variant="h5" gutterBottom>
                        {t("settingsTitle")}
                    </Typography>

                    <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
                        <Tabs
                            value={tabValue}
                            onChange={handleTabChange}
                            variant="fullWidth">
                            <Tab label={t("generalSettings")} />
                            <Tab label={t("proxyRulesDetails")} />
                        </Tabs>
                    </Box>

                    <TabPanel value={tabValue} index={0}>
                        <Box
                            sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                mb: 2
                            }}>
                            <Typography variant="h6">
                                {t("generalSettings")}
                            </Typography>
                            <Box sx={{ display: "flex", gap: 1 }}>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    startIcon={<NetworkCheck />}
                                    onClick={handleTestProxy}
                                    disabled={
                                        !generalSettings.proxyServerAddress ||
                                        !generalSettings.proxyServerPort
                                    }>
                                    {t("testProxyServer")}
                                </Button>
                                <Button
                                    variant="contained"
                                    size="small"
                                    startIcon={<Save />}
                                    onClick={saveSettings}>
                                    {t("saveGeneralSettings")}
                                </Button>
                            </Box>
                        </Box>

                        <Box component="form" sx={{ mt: 2 }}>
                            <Typography
                                variant="subtitle2"
                                sx={{ mb: 2, color: "text.secondary" }}>
                                {t("networkMonitoring")}
                            </Typography>

                            <TextField
                                fullWidth
                                label={t("responseTimeThreshold")}
                                type="number"
                                value={generalSettings.responseTimeThreshold}
                                onChange={handleGeneralSettingChange(
                                    "responseTimeThreshold"
                                )}
                                margin="normal"
                                size="small"
                                helperText={t("responseTimeThresholdHelper")}
                            />

                            <Typography
                                variant="subtitle2"
                                sx={{ mt: 2, mb: 2, color: "text.secondary" }}>
                                {t("proxyServerSettings")}
                            </Typography>

                            <FormControl size="small" sx={{ minWidth: 200 }}>
                                <InputLabel>{t("proxyProtocol")}</InputLabel>
                                <Select
                                    value={generalSettings.proxyServerScheme}
                                    onChange={handleSchemeChange}
                                    label={t("proxyProtocol")}>
                                    {PROXY_SCHEMES.map((scheme) => (
                                        <MenuItem key={scheme} value={scheme}>
                                            {scheme.toUpperCase()}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>

                            <TextField
                                fullWidth
                                label={t("proxyServerAddress")}
                                value={generalSettings.proxyServerAddress}
                                onChange={handleGeneralSettingChange(
                                    "proxyServerAddress"
                                )}
                                margin="normal"
                                size="small"
                                helperText={t("proxyServerAddressHelper")}
                            />

                            <TextField
                                fullWidth
                                label={t("proxyServerPort")}
                                type="number"
                                value={generalSettings.proxyServerPort}
                                onChange={handleGeneralSettingChange(
                                    "proxyServerPort"
                                )}
                                margin="normal"
                                size="small"
                            />

                            <Typography
                                variant="subtitle2"
                                sx={{ mt: 2, mb: 1, color: "text.secondary" }}>
                                {t("proxyAuthSettings")}
                            </Typography>

                            <TextField
                                fullWidth
                                label={t("username")}
                                value={generalSettings.proxyUsername}
                                onChange={handleGeneralSettingChange(
                                    "proxyUsername"
                                )}
                                margin="normal"
                                size="small"
                            />

                            <TextField
                                fullWidth
                                label={t("password")}
                                type="password"
                                value={generalSettings.proxyPassword}
                                onChange={handleGeneralSettingChange(
                                    "proxyPassword"
                                )}
                                margin="normal"
                                size="small"
                            />
                        </Box>
                    </TabPanel>

                    <TabPanel value={tabValue} index={1}>
                        <Box
                            sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                mb: 2
                            }}>
                            <Box
                                sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 1
                                }}>
                                <Typography variant="h6">
                                    {t("proxyRulesDetails")}
                                </Typography>
                                <Typography
                                    variant="body2"
                                    color="text.secondary">
                                    ({proxyRules.length} {t("rulesTotal")})
                                </Typography>
                            </Box>
                            <Box sx={{ display: "flex", gap: 2 }}>
                                <TextField
                                    label={t("searchRules")}
                                    value={searchTerm}
                                    onChange={handleSearchChange}
                                    size="small"
                                    placeholder={t("searchRulesHelper")}
                                    variant="outlined"
                                    sx={{
                                        minWidth: 400,
                                        "& .MuiInputBase-root": {
                                            height: "36px"
                                        },
                                        "& .MuiInputLabel-root": {
                                            top: "-2px"
                                        },
                                        "& .MuiInputLabel-shrink": {
                                            top: "0px"
                                        }
                                    }}
                                />
                                <Button
                                    variant="outlined"
                                    size="small"
                                    startIcon={<Refresh />}
                                    onClick={() =>
                                        proxyRuleService
                                            .getRules()
                                            .then((rules) =>
                                                setProxyRules(rules)
                                            )
                                    }>
                                    {t("reload")}
                                </Button>
                                <Button
                                    variant="contained"
                                    size="small"
                                    startIcon={<Add />}
                                    onClick={handleAddRule}>
                                    {t("addRule")}
                                </Button>
                            </Box>
                        </Box>

                        {filteredProxyRules.length === 0 ? (
                            <Alert severity="info">
                                {searchTerm
                                    ? t("noRulesFoundMessage")
                                    : t("noRulesMessage")}
                            </Alert>
                        ) : (
                            <List dense>
                                {filteredProxyRules.map((rule) => (
                                    <ListItem key={rule.id} divider>
                                        <ListItemText primary={rule.pattern} />
                                        <ListItemSecondaryAction>
                                            <IconButton
                                                edge="end"
                                                aria-label="edit"
                                                size="small"
                                                onClick={() =>
                                                    handleEditRule(rule)
                                                }
                                                sx={{ mr: 1 }}>
                                                <Edit />
                                            </IconButton>
                                            <IconButton
                                                edge="end"
                                                aria-label="delete"
                                                size="small"
                                                onClick={() =>
                                                    handleDeleteRule(rule.id)
                                                }>
                                                <Delete />
                                            </IconButton>
                                        </ListItemSecondaryAction>
                                    </ListItem>
                                ))}
                            </List>
                        )}
                    </TabPanel>

                    {/* Add/Edit Rule Dialog */}
                    <Dialog
                        open={dialogOpen}
                        onClose={handleCloseDialog}
                        maxWidth="sm"
                        fullWidth>
                        <DialogTitle>
                            {editingRule ? t("editRule") : t("addRuleDialog")}
                        </DialogTitle>
                        <DialogContent>
                            <TextField
                                autoFocus
                                margin="dense"
                                label={t("rulePattern")}
                                fullWidth
                                size="small"
                                value={newRulePattern}
                                onChange={(e) =>
                                    setNewRulePattern(e.target.value)
                                }
                                placeholder="*.google.com"
                                helperText={t("rulePatternHelper")}
                            />
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={handleCloseDialog} size="small">
                                {t("cancel")}
                            </Button>
                            <Button
                                onClick={handleSaveRule}
                                variant="contained"
                                size="small">
                                {editingRule ? t("save") : t("add")}
                            </Button>
                        </DialogActions>
                    </Dialog>

                    {/* Test Proxy Dialog */}
                    <Dialog
                        open={testDialogOpen}
                        onClose={handleCloseTestDialog}
                        maxWidth="sm"
                        fullWidth>
                        <DialogTitle>{t("testProxyDialog")}</DialogTitle>
                        <DialogContent>
                            <TextField
                                autoFocus
                                margin="dense"
                                label={t("testTargetUrl")}
                                fullWidth
                                size="small"
                                value={testTarget}
                                onChange={(e) => setTestTarget(e.target.value)}
                                placeholder="https://www.google.com"
                                helperText={t("testTargetUrlHelper")}
                            />
                            {testResult && (
                                <Box
                                    sx={{
                                        mt: 2,
                                        p: 1,
                                        bgcolor: testResult.startsWith("✅")
                                            ? "success.light"
                                            : "error.light",
                                        borderRadius: 1
                                    }}>
                                    <Typography
                                        variant="body2"
                                        color={
                                            testResult.startsWith("✅")
                                                ? "success.contrastText"
                                                : "error.contrastText"
                                        }>
                                        {testResult}
                                    </Typography>
                                </Box>
                            )}
                        </DialogContent>
                        <DialogActions>
                            <Button
                                onClick={handleCloseTestDialog}
                                size="small">
                                {t("close")}
                            </Button>
                            <Button
                                onClick={performProxyTest}
                                variant="contained"
                                size="small"
                                disabled={testing || !testTarget.trim()}
                                startIcon={
                                    testing ? (
                                        <CircularProgress size={16} />
                                    ) : null
                                }>
                                {testing ? t("testing") : t("startTest")}
                            </Button>
                        </DialogActions>
                    </Dialog>

                    {/* Snackbar for notifications */}
                    <Snackbar
                        open={snackbarOpen}
                        autoHideDuration={3000}
                        onClose={handleCloseSnackbar}
                        message={snackbarMessage}
                    />
                </Paper>
            </Container>
            {/* Version Info Footer */}
            <Box
                sx={{
                    mt: 3,
                    py: 2,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0.5,
                    borderTop: 1,
                    borderColor: "divider"
                }}>
                <Typography
                    variant="body2"
                    color="text.primary"
                    fontWeight="medium">
                    Proxy Switch Craft
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    Version {chrome.runtime.getManifest().version}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    by{" "}
                    <a
                        href="mailto:biscuit_zhou@outlook.com"
                        style={{ color: "inherit", textDecoration: "none" }}>
                        biscuit_zhou@outlook.com
                    </a>
                </Typography>
            </Box>
        </>
    )
}

export default Options
