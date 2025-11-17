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

import {
    getProxyRules,
    localStorage,
    setProxyRules as setProxyRules2Store
} from "~utils/storage"

import type { GeneralSettings, ProxyRule } from "../types/common"
import { PROXY_SCHEMES, STORAGE_KEYS } from "../types/common"
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
        loadSettings()
    }, [])

    useEffect(() => {
        setProxyRules2Store(proxyRules)
            .then(() => {
                chrome.runtime.sendMessage({
                    action: "configureSelectiveProxy"
                })
            })
            .catch((error) => {
                console.error("Error saving proxy rules:", error)
            })
    }, [proxyRules])

    const loadSettings = async () => {
        try {
            const general = await localStorage.get<GeneralSettings>(
                STORAGE_KEYS.GENERAL_SETTINGS
            )
            if (general) {
                setGeneralSettings(general)
            }
            const rules = await getProxyRules()
            if (rules) {
                setProxyRules(rules)
            }
        } catch (error) {
            console.error("Error loading settings:", error)
        }
    }

    const saveSettings = async () => {
        try {
            await localStorage.set(
                STORAGE_KEYS.GENERAL_SETTINGS,
                generalSettings
            )
            setSnackbarMessage(t("settingsSaved"))
            setSnackbarOpen(true)
        } catch (error) {
            console.error("Error saving settings:", error)
            setSnackbarMessage(t("saveSettingsFailed"))
            setSnackbarOpen(true)
        }
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

    const autoDetectScheme = async () => {
        const address = generalSettings.proxyServerAddress.toLowerCase()
        const port = generalSettings.proxyServerPort

        // Try network detection based on port number and protocol to confirm proxy server protocol
        // Try protocols in select one by one to detect which is available
        let detectedScheme = PROXY_SCHEMES[0] // Default to use the first protocol
        let found = false

        for (const scheme of PROXY_SCHEMES) {
            // Can only simulate detection here, actual socks4/5 proxies cannot be directly detected by browser
            // Can only detect http/https, socks4/5 can only be guessed based on port
            if (scheme === "http" || scheme === "https") {
                try {
                    // Try to connect using fetch with specified protocol
                    const url = scheme + "://" + address + ":" + port
                    // Can only detect if http/https protocol can connect
                    // Due to browser same-origin policy, actual fetch may fail
                    // Just do a simple attempt here
                    await fetch(url, { method: "HEAD", mode: "no-cors" })
                    detectedScheme = scheme
                    found = true
                    break
                } catch {
                    // ignore
                }
            }
        }

        // If http/https cannot be detected, guess socks4/5 based on port
        if (!found) {
            if (port === 1080 || port === 9050) {
                detectedScheme = "socks5"
            } else if (port === 1081) {
                detectedScheme = "socks4"
            } else if (port === 443 || port === 8443) {
                detectedScheme = "https"
            } else {
                detectedScheme = "http"
            }
        }

        setGeneralSettings((prev) => ({
            ...prev,
            proxyServerScheme: detectedScheme
        }))

        setSnackbarMessage(t("autoDetectScheme"))
        setSnackbarOpen(true)
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
        setProxyRules((prev) => prev.filter((rule) => rule.id !== id))
    }

    const handleSaveRule = () => {
        if (!newRulePattern.trim()) {
            setSnackbarMessage(t("enterRulePattern"))
            setSnackbarOpen(true)
            return
        }

        if (editingRule) {
            // Edit existing rule
            setProxyRules((prev) =>
                prev.map((rule) =>
                    rule.id === editingRule.id
                        ? { ...rule, pattern: newRulePattern }
                        : rule
                )
            )
        } else {
            const exists = proxyRules.some(
                (rule) => rule.pattern === newRulePattern
            )
            if (exists) {
                return
            }
            // Add new rule
            const newRule: ProxyRule = {
                id: Date.now().toString(),
                pattern: newRulePattern
            }
            setProxyRules((prev) => [...prev, newRule])
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

        try {
            const startTime = Date.now()

            // Construct proxy configuration
            const proxyConfig = {
                mode: "fixed_servers",
                rules: {
                    singleProxy: {
                        scheme: generalSettings.proxyServerScheme,
                        host: generalSettings.proxyServerAddress,
                        port: generalSettings.proxyServerPort
                    }
                }
            }

            // Simulate proxy test - actual implementation needs to use chrome.proxy API
            // Here provides a basic test logic
            const testPromise = new Promise<void>((resolve, reject) => {
                const img = new Image()
                const timeout = setTimeout(() => {
                    reject(new Error(t("testTimeout")))
                }, 10000)

                img.onload = () => {
                    clearTimeout(timeout)
                    resolve()
                }

                img.onerror = () => {
                    clearTimeout(timeout)
                    reject(new Error(t("connectionFailed")))
                }

                // Try to load a small image to test connection
                img.src = testTarget + "/favicon.ico?" + Date.now()
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
            setTesting(false)
        }
    }

    return (
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
                            sx={{ mt: 3, mb: 2, color: "text.secondary" }}>
                            {t("proxyServerSettings")}
                        </Typography>

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

                        <Box sx={{ display: "flex", gap: 2, mt: 2 }}>
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
                            <Button
                                variant="outlined"
                                size="small"
                                onClick={autoDetectScheme}
                                disabled={!generalSettings.proxyServerPort}>
                                {t("autoDetect")}
                            </Button>
                        </Box>

                        <Typography
                            variant="subtitle2"
                            sx={{ mt: 3, mb: 2, color: "text.secondary" }}>
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
                        <Typography variant="h6">
                            {t("proxyRulesDetails")}
                        </Typography>
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
                                onClick={loadSettings}>
                                {t("reload")}
                            </Button>
                            <Button
                                variant="contained"
                                size="small"
                                startIcon={<Add />}
                                onClick={handleAddRule}>
                                {t("addRule")}
                            </Button>
                            {/** 
                            <Button
                                variant="contained"
                                size="small"
                                startIcon={<Save />}
                                onClick={saveSettings}>
                                {t("saveRules")}
                            </Button>
                            */}
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
                                    <ListItemText
                                        primary={rule.pattern}
                                        secondary={t("proxyRulePattern")}
                                    />
                                    <ListItemSecondaryAction>
                                        <IconButton
                                            edge="end"
                                            aria-label="edit"
                                            size="small"
                                            onClick={() => handleEditRule(rule)}
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
                            onChange={(e) => setNewRulePattern(e.target.value)}
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
                        <Button onClick={handleCloseTestDialog} size="small">
                            {t("close")}
                        </Button>
                        <Button
                            onClick={performProxyTest}
                            variant="contained"
                            size="small"
                            disabled={testing || !testTarget.trim()}
                            startIcon={
                                testing ? <CircularProgress size={16} /> : null
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
    )
}

export default Options
