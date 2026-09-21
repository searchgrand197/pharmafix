import React from 'react'
import {
  AccessTime as AccessTimeIcon,
  Add as AddIcon,
  AutoAwesome as AutoAwesomeIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  Autorenew as AutorenewIcon,
  Bed as BedMuiIcon,
  CalendarMonth as CalendarMonthIcon,
  Cancel as CancelIcon,
  CheckCircle as CheckCircleMuiIcon,
  Checklist as ChecklistIcon,
  ContentCopy as ContentCopyIcon,
  Star as StarMuiIcon,
  ChevronRight as ChevronRightIcon,
  Close as CloseIcon,
  CurrencyRupee as CurrencyRupeeIcon,
  Delete as DeleteIcon,
  Description as DescriptionIcon,
  Download as DownloadMuiIcon,
  Engineering as EngineeringIcon,
  ExpandLess as ExpandLessIcon,
  Print as PrintIcon,
  ExpandMore as ExpandMoreIcon,
  Home as HomeMuiIcon,
  Lock as LockMuiIcon,
  LockOpen as LockOpenMuiIcon,
  MedicalServices as MedicalServicesIcon,
  Medication as MedicationIcon,
  MonitorHeart as MonitorHeartIcon,
  PersonAdd as PersonAddIcon,
  Person as PersonIcon,
  Search as SearchMuiIcon,
  Send as SendMuiIcon,
  Security as SecurityIcon,
  Settings as SettingsIcon,
  Store as StoreMuiIcon,
  ToggleOff as ToggleOffIcon,
  ToggleOn as ToggleOnIcon,
  TrendingDown as TrendingDownMuiIcon,
  TrendingUp as TrendingUpMuiIcon,
  Groups as GroupsIcon,
  Folder as FolderIcon,
  Science as ScienceIcon,
  Visibility as VisibilityIcon,
  Edit as EditIcon,
  WarningAmber as WarningAmberIcon,
  Inventory2 as Inventory2Icon,
  LocalOffer as LocalOfferIcon,
  DragIndicator as DragIndicatorIcon,
  Save as SaveMuiIcon,
  Waves as WavesIcon,
  AccountBalanceWallet as AccountBalanceWalletIcon,
  AddBox as AddBoxIcon,
  Apartment as ApartmentIcon,
  Archive as ArchiveIcon,
  AssignmentTurnedIn as AssignmentTurnedInIcon,
  AttachFile as AttachFileIcon,
  BarChart as BarChartIcon,
  Business as BusinessIcon,
  Check as CheckIcon,
  ChevronLeft as ChevronLeftIcon,
  CircleOutlined as CircleOutlinedIcon,
  Dashboard as DashboardIcon,
  DoneAll as DoneAllIcon,
  Draw as DrawIcon,
  EmojiEvents as EmojiEventsIcon,
  EventAvailable as EventAvailableIcon,
  Explore as ExploreIcon,
  FactCheck as FactCheckIcon,
  FilterList as FilterListIcon,
  Fingerprint as FingerprintIcon,
  FormatAlignCenter as FormatAlignCenterIcon,
  FormatAlignLeft as FormatAlignLeftIcon,
  FormatAlignRight as FormatAlignRightIcon,
  History as HistoryIcon,
  HowToReg as HowToRegIcon,
  Image as ImageIcon,
  Inbox as InboxIcon,
  Info as InfoIcon,
  Key as KeyIcon,
  Layers as LayersIcon,
  Lightbulb as LightbulbIcon,
  Link as LinkIcon,
  LocalHospital as LocalHospitalIcon,
  Login as LoginIcon,
  Logout as LogoutIcon,
  Mail as MailIcon,
  Map as MapIcon,
  MenuBook as MenuBookIcon,
  Notifications as NotificationsIcon,
  OpenInFull as OpenInFullIcon,
  OpenInNew as OpenInNewIcon,
  Palette as PaletteIcon,
  PersonOff as PersonOffIcon,
  Phone as PhoneIcon,
  Place as PlaceIcon,
  PlayArrow as PlayArrowIcon,
  PowerSettingsNew as PowerSettingsNewIcon,
  RotateLeft as RotateLeftIcon,
  Schedule as ScheduleIcon,
  Share as ShareIcon,
  ShowChart as ShowChartIcon,
  TextFields as TextFieldsIcon,
  TouchApp as TouchAppIcon,
  Undo as UndoIcon,
  Upload as UploadIcon,
  UploadFile as UploadFileIcon,
  VerifiedUser as VerifiedUserIcon,
  Videocam as VideocamIcon,
  ViewColumn as ViewColumnIcon,
  ViewSidebar as ViewSidebarIcon,
  Wifi as WifiIcon,
  WifiOff as WifiOffIcon,
  Work as WorkIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
} from '@mui/icons-material'

function asLucide(Icon) {
  return function LucideCompat({ size, className, sx, ...rest }) {
    return <Icon className={className} sx={{ ...(size ? { fontSize: size } : {}), ...sx }} {...rest} />
  }
}

export const Calendar = asLucide(CalendarMonthIcon)
export const Eye = asLucide(VisibilityIcon)
export const Loader2 = asLucide(AutorenewIcon)
export const Pencil = asLucide(EditIcon)
export const Edit2 = asLucide(EditIcon)
export const RefreshCw = asLucide(AutorenewIcon)
export const SearchIconCompat = asLucide(SearchMuiIcon)
export const Search = SearchIconCompat
export const Plus = asLucide(AddIcon)
export const X = asLucide(CloseIcon)
export const Clock3 = asLucide(AccessTimeIcon)
export const Stethoscope = asLucide(MedicalServicesIcon)
export const UserRound = asLucide(PersonIcon)
export const TrendingUp = asLucide(TrendingUpMuiIcon)
export const Users = asLucide(GroupsIcon)
export const DollarSign = asLucide(CurrencyRupeeIcon)
export const Activity = asLucide(MonitorHeartIcon)
export const Pill = asLucide(MedicationIcon)
export const Trash2 = asLucide(DeleteIcon)
export const ArrowLeft = asLucide(ArrowBackIcon)
export const Package = asLucide(Inventory2Icon)
export const Folder = asLucide(FolderIcon)
export const CheckCircle2 = asLucide(CheckCircleMuiIcon)
export const CheckCircleIconCompat = asLucide(CheckCircleMuiIcon)
export const CheckCircle = CheckCircleIconCompat
export const StoreIconCompat = asLucide(StoreMuiIcon)
export const Store = StoreIconCompat
export const ArrowRight = asLucide(ArrowForwardIcon)
export const DownloadIconCompat = asLucide(DownloadMuiIcon)
export const Download = DownloadIconCompat
export const FileText = asLucide(DescriptionIcon)
export const AlertTriangle = asLucide(WarningAmberIcon)
export const Receipt = asLucide(DescriptionIcon)
export const Clock = asLucide(AccessTimeIcon)
export const Printer = asLucide(PrintIcon)
export const Beaker = asLucide(ScienceIcon)
export const ChevronDown = asLucide(ExpandMoreIcon)
export const ChevronUp = asLucide(ExpandLessIcon)
export const ChevronRight = asLucide(ChevronRightIcon)
export const Wind = asLucide(WavesIcon)
export const Fan = asLucide(SettingsIcon)
export const Bed = asLucide(BedMuiIcon)
export const Wrench = asLucide(EngineeringIcon)
export const Sparkles = asLucide(AutoAwesomeIcon)
export const Shield = asLucide(SecurityIcon)
export const Home = asLucide(HomeMuiIcon)
export const ClipboardList = asLucide(ChecklistIcon)
export const Lock = asLucide(LockMuiIcon)
export const LockOpen = asLucide(LockOpenMuiIcon)
export const PenLine = asLucide(EditIcon)
export const Send = asLucide(SendMuiIcon)
export const UserPlus = asLucide(PersonAddIcon)
export const TrendingDown = asLucide(TrendingDownMuiIcon)
export const Wallet = asLucide(AccountBalanceWalletIcon)
export const IndianRupee = asLucide(CurrencyRupeeIcon)
export const ToggleLeft = asLucide(ToggleOffIcon)
export const ToggleRight = asLucide(ToggleOnIcon)
export const AlertCircle = asLucide(WarningAmberIcon)
export const User = asLucide(PersonIcon)
export const Tag = asLucide(LocalOfferIcon)
export const GripVertical = asLucide(DragIndicatorIcon)
export const Save = asLucide(SaveMuiIcon)
export const XCircle = asLucide(CancelIcon)
export const Copy = asLucide(ContentCopyIcon)
export const Star = asLucide(StarMuiIcon)

const fallbackLucide = asLucide(InfoIcon)

export const AlignCenter = asLucide(FormatAlignCenterIcon)
export const AlignLeft = asLucide(FormatAlignLeftIcon)
export const AlignRight = asLucide(FormatAlignRightIcon)
export const Archive = asLucide(ArchiveIcon)
export const ArrowDownToLine = asLucide(DownloadMuiIcon)
export const ArrowUpFromLine = asLucide(UploadIcon)
export const Award = asLucide(EmojiEventsIcon)
export const BarChart3 = asLucide(BarChartIcon)
export const Bell = asLucide(NotificationsIcon)
export const BookOpen = asLucide(MenuBookIcon)
export const Briefcase = asLucide(WorkIcon)
export const Building = asLucide(BusinessIcon)
export const Building2 = asLucide(ApartmentIcon)
export const CalendarCheck = asLucide(EventAvailableIcon)
export const CalendarClock = asLucide(ScheduleIcon)
export const CalendarDays = asLucide(CalendarMonthIcon)
export const Camera = asLucide(ImageIcon)
export const Check = asLucide(CheckIcon)
export const CheckCheck = asLucide(DoneAllIcon)
export const ChevronLeft = asLucide(ChevronLeftIcon)
export const Circle = asLucide(CircleOutlinedIcon)
export const ClipboardCheck = asLucide(AssignmentTurnedInIcon)
export const Columns = asLucide(ViewColumnIcon)
export const Compass = asLucide(ExploreIcon)
export const Edit = asLucide(EditIcon)
export const Edit3 = asLucide(EditIcon)
export const ExternalLink = asLucide(OpenInNewIcon)
export const FileCheck = asLucide(FactCheckIcon)
export const FileImage = asLucide(ImageIcon)
export const FileSignature = asLucide(DrawIcon)
export const FileStack = asLucide(LayersIcon)
export const FileType2 = asLucide(DescriptionIcon)
export const FileUp = asLucide(UploadFileIcon)
export const Filter = asLucide(FilterListIcon)
export const Fingerprint = asLucide(FingerprintIcon)
export const FlaskConical = asLucide(ScienceIcon)
export const History = asLucide(HistoryIcon)
export const Hospital = asLucide(LocalHospitalIcon)
export const Image = asLucide(ImageIcon)
export const Inbox = asLucide(InboxIcon)
export const Info = asLucide(InfoIcon)
export const KeyRound = asLucide(KeyIcon)
export const Layers = asLucide(LayersIcon)
export const Layout = asLucide(DashboardIcon)
export const LayoutDashboard = asLucide(DashboardIcon)
export const Lightbulb = asLucide(LightbulbIcon)
export const LineChart = asLucide(ShowChartIcon)
export const Link2 = asLucide(LinkIcon)
export const List = asLucide(ChecklistIcon)
export const ListTodo = asLucide(ChecklistIcon)
export const LogIn = asLucide(LoginIcon)
export const LogOut = asLucide(LogoutIcon)
export const Mail = asLucide(MailIcon)
export const Map = asLucide(MapIcon)
export const MapPin = asLucide(PlaceIcon)
export const Maximize2 = asLucide(OpenInFullIcon)
export const MousePointer2 = asLucide(TouchAppIcon)
export const Palette = asLucide(PaletteIcon)
export const PanelLeft = asLucide(ViewSidebarIcon)
export const Paperclip = asLucide(AttachFileIcon)
export const Phone = asLucide(PhoneIcon)
export const Play = asLucide(PlayArrowIcon)
export const PlusSquare = asLucide(AddBoxIcon)
export const Power = asLucide(PowerSettingsNewIcon)
export const RotateCcw = asLucide(RotateLeftIcon)
export const Settings = asLucide(SettingsIcon)
export const Share2 = asLucide(ShareIcon)
export const ShieldCheck = asLucide(VerifiedUserIcon)
export const Type = asLucide(TextFieldsIcon)
export const Undo2 = asLucide(UndoIcon)
export const Upload = asLucide(UploadIcon)
export const UserCheck = asLucide(HowToRegIcon)
export const UserRoundCheck = asLucide(HowToRegIcon)
export const UserX = asLucide(PersonOffIcon)
export const Video = asLucide(VideocamIcon)
export const Wifi = asLucide(WifiIcon)
export const WifiOff = asLucide(WifiOffIcon)
export const ZoomIn = asLucide(ZoomInIcon)
export const ZoomOut = asLucide(ZoomOutIcon)

export default new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === '__esModule') return true
      if (typeof prop !== 'string') return undefined
      return fallbackLucide
    },
  },
)
